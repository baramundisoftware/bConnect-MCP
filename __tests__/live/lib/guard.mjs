/**
 * Request guard of the live tier, for the test process and the spawned servers.
 * Plain JavaScript: the spawned servers load it with `node --import`.
 *
 * Only GET requests to the configured bMS origin leave the process. Every other
 * method and origin, every credential-returning route (`isSecretRoute` from the
 * shared core, the same list the client's own gate uses) and every redirect is
 * refused and recorded.
 */
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
  return { server, refused };
}
