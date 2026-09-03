/**
 * bconnect-mcp-gateway — per-domain MCP server pool (PER-15 / OPT-34).
 *
 * THE DEFECT. The POST handler used to call `factory(undefined)` inline, so
 * every HTTP request built a fresh createServer() — and with it a fresh
 * client-provider closure, a fresh axios instance, a fresh https.Agent, an empty
 * response cache and a reset client-side rate-limit window — all torn down when
 * the response closed. That is exactly the per-call client lifecycle that
 * packages/mcp-core/src/client-provider.ts spends its header documenting as
 * defect R3/B8: over HTTP, BCONNECT_CACHE_ENABLED could never produce a hit and
 * BCONNECT_RATE_LIMIT_ENABLED never accumulated a window. Since PER-12 turned on
 * HTTP keep-alive, a per-request agent also threw away every pooled TLS
 * connection to bMS.
 *
 * WHY A POOL AND NOT A SINGLETON. The obvious fix — memoize one Server per
 * domain — does not work: the SDK's Protocol.connect() throws "Already connected
 * to a transport" if a Server is connected while it already has one, and the
 * Streamable HTTP transport itself refuses reuse ("Stateless transport cannot be
 * reused across requests"). So the SDK's one-server-per-in-flight-request
 * invariant has to hold. This pool holds it exactly: a server is handed to at
 * most one request at a time and is only returned to the idle set after its
 * transport has fully closed and the Server has released it (server.transport is
 * undefined again). Sequential requests reuse an instance — which is what
 * recovers the client, agent and cache — while concurrent requests each get
 * their own, exactly as before.
 *
 * The pooled Servers all share one credential: the gateway passes no per-request
 * credential (single-credential mode, ADR-0003), so there is no caller identity
 * to isolate between them. If per-request credentials are ever introduced, this
 * pool must be keyed on the credential fingerprint, not on the domain alone.
 *
 * Config (env):
 *   MCP_GATEWAY_SERVER_POOL_MAX  idle servers kept per domain (default 8;
 *                                0 disables pooling and restores the old
 *                                build-and-discard behaviour).
 */

/** The subset of the SDK Server surface the gateway uses. */
export interface PoolableServer {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  /** SDK getter — undefined once the transport has closed. */
  readonly transport?: unknown;
}

export type ServerFactory = () => PoolableServer;

function maxIdlePerDomain(): number {
  const raw = parseInt(process.env.MCP_GATEWAY_SERVER_POOL_MAX ?? "", 10);
  return Number.isNaN(raw) || raw < 0 ? 8 : raw;
}

export interface ServerPool {
  /** Take an idle server for this domain, or build one. */
  acquire(domain: string, build: ServerFactory): PoolableServer;
  /** Return a disconnected server. Servers still holding a transport are dropped. */
  release(domain: string, server: PoolableServer): void;
  /** Idle count per domain — for tests and diagnostics. */
  stats(): Record<string, number>;
}

export function createServerPool(): ServerPool {
  const idle = new Map<string, PoolableServer[]>();
  const maxIdle = maxIdlePerDomain();

  return {
    acquire(domain, build) {
      const reused = idle.get(domain)?.pop();
      return reused ?? build();
    },

    release(domain, server) {
      // Belt and braces: if the transport has not detached, reusing this server
      // would make the next connect() throw. Drop it instead — the pool is an
      // optimisation and must never be able to fail a request.
      if (maxIdle === 0 || server.transport !== undefined) {
        void Promise.resolve(server.close()).catch(() => { /* already closed */ });
        return;
      }
      const bucket = idle.get(domain) ?? [];
      if (bucket.length >= maxIdle) {
        void Promise.resolve(server.close()).catch(() => { /* already closed */ });
        return;
      }
      bucket.push(server);
      idle.set(domain, bucket);
    },

    stats() {
      const out: Record<string, number> = {};
      for (const [domain, bucket] of idle) {
        out[domain] = bucket.length;
      }
      return out;
    },
  };
}
