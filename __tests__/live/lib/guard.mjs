/**
 * Request guard of the live tier, for the test process and the spawned servers.
 * Plain JavaScript: the spawned servers load it with `node --import`.
 *
 * Of the requests sent through Node's http/https modules (including named ESM
 * imports), axios and fetch, only GET requests to the configured bMS origin leave
 * the process. Every other method and origin, every credential-returning route
 * (`isSecretRoute` from the shared core, the same list the client's own gate uses)
 * and every redirect is refused and recorded.
 *
 * Not covered: raw sockets (net, tls), worker threads, and a fetch reference taken
 * before start(). The servers use none of these; the read-only bMS account is the
 * safety net beyond the guard.
 */
import * as nodeHttp from 'node:http';
import * as nodeHttps from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { isSecretRoute } from '@bconnect/mcp-core';
import { setupServer } from 'msw/node';
import { http, HttpResponse, passthrough } from 'msw';

/** Why a request may not leave the process, or undefined when it may. */
export function refusal(method, url, origin) {
  if (method.toUpperCase() !== 'GET') return `method ${method.toUpperCase()}`;
  if (new URL(url).origin !== origin) return 'another origin';
  if (isSecretRoute(method, url)) return 'credential route';
  return undefined;
}

/**
 * MSW passes a request through on a connection of its own, opened with the
 * client agent's options. The agent's `timeout` is its idle-socket limit (5 s in
 * the shared core), and on that connection it also runs while an answer is
 * awaited: MSW reports the connection's timeout as the request's, so every bMS
 * answer slower than 5 s failed as "didn't answer within <BCONNECT_TIMEOUT_MS>"
 * (v26.1.12 Windows run). Outside the guard the request's own timeout replaces
 * the agent's on the socket, so the servers aren't affected. While the guard is
 * installed, connections are opened without the agent's idle limit; the
 * request's timeout (BCONNECT_TIMEOUT_MS) still applies on MSW's socket.
 */
const agentModules = [nodeHttp.Agent.prototype, nodeHttps.Agent.prototype];
let savedCreateConnection;
function withoutIdleTimeout() {
  if (savedCreateConnection) return;
  savedCreateConnection = agentModules.map((proto) => Object.getOwnPropertyDescriptor(proto, 'createConnection'));
  agentModules.forEach((proto, i) => {
    const original = savedCreateConnection[i].value;
    proto.createConnection = function createConnection(options, callback) {
      const { timeout: _idle, ...rest } = options ?? {};
      return original.call(this, rest, callback);
    };
  });
}
function restoreIdleTimeout() {
  if (!savedCreateConnection) return;
  agentModules.forEach((proto, i) => Object.defineProperty(proto, 'createConnection', savedCreateConnection[i]));
  savedCreateConnection = undefined;
}

/**
 * An MSW server that passes allowed requests through to the bMS and fails the
 * others before they leave the process. `refused` lists them by method and path
 * (no host). `onRequest` sees every request with the reason it was refused, if it
 * was; `onResponse` sees every answer that came back from the bMS.
 *
 * A redirect answer is recorded as refused, and the request that would follow it
 * is refused: a run that meets a redirect fails.
 */
export function createGuard({ origin, onRequest, onResponse }) {
  const refused = [];
  const redirectTargets = new Set();
  const refuse = (request, reason) => {
    refused.push({ method: request.method, path: new URL(request.url).pathname, reason });
    return HttpResponse.error();
  };
  const server = setupServer(
    http.all('*', ({ request }) => {
      const reason = redirectTargets.delete(request.url) ? 'redirect target' : refusal(request.method, request.url, origin);
      onRequest?.(request, reason);
      return reason ? refuse(request, reason) : passthrough();
    }),
  );
  server.events.on('response:bypass', ({ request, response }) => {
    if (response.status >= 300 && response.status < 400) {
      refused.push({ method: request.method, path: new URL(request.url).pathname, reason: `redirect (${response.status})` });
      const location = response.headers.get('location');
      if (location) redirectTargets.add(new URL(location, request.url).href);
    }
    onResponse?.(request, response);
  });
  let guardedFetch;
  return {
    server,
    refused,
    /**
     * Install the guard. MSW patches the CommonJS `http`/`https` modules; named ESM
     * imports (`import { request } from 'node:http'`) keep the original functions
     * until the builtin ESM exports are resynced.
     *
     * `fetch` follows redirects itself (undici, `redirect: 'follow'` by default),
     * underneath the guard. Every fetch is sent with `redirect: 'manual'`, so the
     * 3xx comes back as an answer, is recorded as refused, and is not followed.
     */
    start() {
      withoutIdleTimeout();
      server.listen({ onUnhandledRequest: 'error' });
      syncBuiltinESMExports();
      guardedFetch = globalThis.fetch;
      const inner = guardedFetch;
      globalThis.fetch = (input, init) => inner(input, { ...init, redirect: 'manual' });
    },
    stop() {
      if (guardedFetch) globalThis.fetch = guardedFetch;
      guardedFetch = undefined;
      server.close();
      restoreIdleTimeout();
      syncBuiltinESMExports();
    },
  };
}
