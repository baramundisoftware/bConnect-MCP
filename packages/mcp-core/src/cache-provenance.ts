/**
 * Which bMS a cached file came from.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Two modules cache expensive reads to disk, both at a FIXED path under
 * `os.tmpdir()/bconnect-mcp/`, with nothing in the path or the payload
 * recording which server the data came from.
 *
 * `secure-disk-cache.ts` closes the cross-USER case — owner-only 0700/0600,
 * and a file that is a symlink, not ours, or group/world-writable is refused.
 * It does not close the cross-TENANT case, because that is not a permissions
 * problem: two MCP configurations under ONE OS user, pointing at two different
 * bMS servers, resolve the same path and read each other's data. Nothing about
 * that trips a permission check, because the same user legitimately owns both.
 *
 * The consequence is specific and bad. `scan-recency` keys its history by
 * endpoint DISPLAY NAME, and display names collide across estates — `WIN10-01`
 * exists in most of them. So a scan from server A can be attributed to a
 * same-named endpoint on server B, for the 15 minutes of the TTL, and the
 * module whose entire purpose is deciding whether a scan is recent enough to
 * trust gets its dates from the wrong estate. The vulnerability library has the
 * same shape: an estate's CVE set served as another's.
 *
 * ── What a fingerprint is made of, and what it must not leak ────────────────
 * The base URL identifies the server. The credential identifies WHO the data
 * was read as, which matters because two operators against one bMS can have
 * differently-scoped API keys — an RBAC-limited key's partial view must not be
 * served to a broader one as though complete.
 *
 * The credential is therefore hashed, never stored: this value ends up in a
 * FILENAME, and filenames are readable by anything that can list the directory.
 * The hash is truncated — enough to separate tenants, not enough to be worth
 * attacking, and it is a partitioning key rather than a secret.
 */

import { createHash } from "node:crypto";

/** Length of the hex fingerprint that reaches a filename. */
const FINGERPRINT_LENGTH = 16;

export interface CacheProvenanceInput {
  /** The resolved bConnect base URL. */
  baseUrl?: string | undefined;
  /** The API key, if that is the auth in use. Hashed, never stored. */
  apiKey?: string | undefined;
  /** The Basic-auth username, if that is the auth in use. */
  username?: string | undefined;
}

/**
 * A short, stable, non-reversible id for "this server, read as this identity".
 *
 * Deliberately NOT a function of anything that changes per process — no pid, no
 * timestamp, no random salt — because a cache that never hits is not a cache.
 * Two runs of the same deployment must produce the same fingerprint.
 */
export function cacheProvenanceFingerprint(input: CacheProvenanceInput): string {
  // Normalise the URL so `https://bms/bconnect` and `https://BMS/bconnect/`
  // are one tenant rather than two. Host case and a trailing slash are not
  // meaningful differences; anything else is left alone.
  const baseUrl = String(input.baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/^(https?:\/\/)([^/]+)/i, (_m, scheme: string, host: string) => scheme.toLowerCase() + host.toLowerCase());

  // The identity half. A hash of the API key, or the username verbatim — a
  // username is not a secret, and keeping it readable in the digest input
  // makes the fingerprint reproducible from configuration alone.
  const identity = input.apiKey
    ? `key:${createHash("sha256").update(input.apiKey).digest("hex")}`
    : `user:${String(input.username ?? "")}`;

  return createHash("sha256")
    .update(`${baseUrl}\n${identity}`)
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}

/**
 * The fingerprint for this process's configured deployment.
 *
 * The environment is the right source and not a shortcut: `runServer` builds
 * the client from exactly these variables, and two MCP configurations under one
 * OS user each launch their own server process with their own environment —
 * which is precisely the situation that made a shared cache path wrong. Reading
 * it here avoids threading credentials through call signatures that never
 * carried them, and avoids widening a module's surface to expose its client.
 *
 * Read per call, never memoised: a long-lived process whose environment is
 * re-read must partition to the new tenant rather than keep serving the old
 * one's data.
 */
export function cacheProvenanceFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return cacheProvenanceFingerprint({
    baseUrl: env.BCONNECT_BASE_URL,
    apiKey: env.BCONNECT_API_KEY,
    username: env.BCONNECT_USERNAME,
  });
}

/**
 * Read the fingerprint inputs off a configured axios instance.
 *
 * Both cache sites already hold the client, so this avoids threading
 * credentials through call signatures that never carried them — and avoids
 * every caller inventing its own idea of what identifies a tenant.
 */
export function fingerprintFromHttpClient(httpClient: {
  defaults?: {
    baseURL?: string | undefined;
    headers?: Record<string, unknown> | undefined;
  };
}): string {
  const defaults = httpClient?.defaults ?? {};
  const headers = (defaults.headers ?? {}) as Record<string, unknown> & {
    common?: Record<string, unknown>;
  };
  const common = (headers.common ?? {}) as Record<string, unknown>;
  const apiKey = (common["X-Api-Key"] ?? headers["X-Api-Key"]) as string | undefined;
  const authorization = (common["Authorization"] ?? headers["Authorization"]) as string | undefined;

  // For Basic auth the whole header is the identity; hashing it as a "key" is
  // correct — it must not reach a filename in decodable form.
  return cacheProvenanceFingerprint({
    baseUrl: defaults.baseURL,
    apiKey: apiKey ?? authorization,
  });
}

/**
 * Insert the fingerprint into a cache filename:
 * `vulnerability-library.json` -> `vulnerability-library.<fingerprint>.json`.
 *
 * The fingerprint goes in the FILENAME and not only inside the payload, so two
 * tenants never contend for one file at all — a same-path cache would have one
 * of them overwriting the other's data on every refresh even if each correctly
 * refused to READ it.
 */
export function fingerprintedCacheName(fileName: string, fingerprint: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0
    ? `${fileName}.${fingerprint}`
    : `${fileName.slice(0, dot)}.${fingerprint}${fileName.slice(dot)}`;
}
