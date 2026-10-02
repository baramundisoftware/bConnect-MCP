/**
 * Preload for the server processes the live tier spawns:
 *   node --import <this file> <server>/build/index.js
 *
 * Installs the same request guard as the test process (lib/guard.mjs) for the
 * origin of BCONNECT_BASE_URL. It appends one JSON line per request, and one per
 * redirect answer, to the file named by LIVE_GUARD_LOG: method, path, query, and
 * the refusal reason if any.
 * The test reads the log to assert that startup sent only the startup check.
 */
import { appendFileSync } from 'node:fs';
import { createGuard } from './lib/guard.mjs';

const log = process.env.LIVE_GUARD_LOG;
const base = process.env.BCONNECT_BASE_URL;
if (!log || !base) throw new Error('child-guard: LIVE_GUARD_LOG and BCONNECT_BASE_URL are required');

const write = (request, refused) => {
  const url = new URL(request.url);
  appendFileSync(log, JSON.stringify({
    method: request.method, path: url.pathname, query: url.search.replace(/^\?/, ''), ...(refused && { refused }),
  }) + '\n');
};

const guard = createGuard({
  origin: new URL(base).origin,
  onRequest: write,
  // A redirect answer is logged as refused too: the servers don't follow redirects,
  // so without this line a startup that met one would leave no trace.
  onResponse: (request, response) => {
    if (response.status >= 300 && response.status < 400) write(request, `redirect (${response.status})`);
  },
});
guard.server.listen({ onUnhandledRequest: 'error' });
