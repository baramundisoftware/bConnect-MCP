/**
 * Retries for reads (#425; replaces axios-retry, deprecated 2026-11-10).
 *
 * - Only GET is retried: a write is never sent twice (REQ-XC-003 AC 2).
 * - Retried: no answer (network error, timeout) and 502/503/504. Not retried:
 *   4xx, 429 and 500 (#162).
 * - Up to `maxRetries` retries (BCONNECT_MAX_RETRIES, 0–5, default 0), after
 *   `retryDelay × 2^(retry − 1)` ms (default 100 ms); each try gets the full timeout.
 * - A read that failed on a kept-alive connection the server had already
 *   closed goes once more, after the configured retries (#160).
 * - `noRetry: true` on a request turns it off for that request (#159).
 *
 * A retry is sent through the same axios instance, so it passes the whole
 * interceptor chain again: the guards, the rate limiter and the audit log see
 * every try. Register this before the client's own response step, as
 * axios-retry was: its outcome (a processed response, or an already mapped
 * error) then reaches that step, which passes it on as is.
 */
import { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";

declare module "axios" {
  interface AxiosRequestConfig {
    /** Send this request once, whatever the retry settings (#425). */
    noRetry?: boolean;
    /** Retries already made for this request; set by the read retry. */
    retriesMade?: number;
  }
}

export interface ReadRetryOptions {
  /** Retries after the first try (BCONNECT_MAX_RETRIES); 0 or unset: none. */
  maxRetries?: number;
  /** Base delay in ms (default 100), doubled for each further retry. */
  retryDelay?: number;
}

/** Delay before retry number `retry` (1 for the first), in ms. */
export function retryDelayMs(retry: number, baseDelay = 100): number {
  return baseDelay * 2 ** (retry - 1);
}

/** A request that went out on a reused kept-alive connection which the server had already closed. */
export function staleReusedSocket(error: AxiosError): boolean {
  const reused = (error.request as { reusedSocket?: boolean } | undefined)?.reusedSocket === true;
  return reused && !error.response && (error.code === "ECONNRESET" || /socket hang up/i.test(error.message));
}

/** Whether a failed request is tried again, after `retriesMade` retries. */
export function shouldRetryRead(error: AxiosError, retriesMade: number, maxRetries: number): boolean {
  if (error.config?.noRetry === true || (error.config?.method ?? "get").toUpperCase() !== "GET") {
    return false;
  }
  if (retriesMade >= maxRetries) {
    // The one try on a new connection after a stale kept-alive one (#160).
    return retriesMade === maxRetries && staleReusedSocket(error);
  }
  if (!error.response) {
    return true;
  }
  return [502, 503, 504].includes(error.response.status);
}

/** Waits `ms`, or less when the request is aborted meanwhile (its re-send then fails as cancelled). */
function wait(ms: number, signal: InternalAxiosRequestConfig["signal"]): Promise<void> {
  if (signal?.aborted) {return Promise.resolve();}
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener?.("abort", done, { once: true });
  });
}

/** Installs the read retry on `instance` (a response error step). */
export function installReadRetry(instance: AxiosInstance, options: ReadRetryOptions = {}): void {
  const maxRetries = options.maxRetries || 0;
  const baseDelay = options.retryDelay || 100;
  instance.interceptors.response.use(undefined, async (error: unknown) => {
    // Only a request's own failure carries what is needed to send it again; a
    // refusal before sending (guards, rate limiter) or an already mapped error doesn't.
    if (!(error instanceof AxiosError) || !error.config) {
      throw error;
    }
    const config = error.config;
    const retriesMade = config.retriesMade ?? 0;
    if (!shouldRetryRead(error, retriesMade, maxRetries)) {
      throw error;
    }
    config.retriesMade = retriesMade + 1;
    await wait(retryDelayMs(config.retriesMade, baseDelay), config.signal);
    return instance.request(config);
  });
}
