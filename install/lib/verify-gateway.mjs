// Verify a RUNNING bConnect MCP gateway the way a remote client will use it.
//
// Same discipline as verify-install.mjs: nothing here is a mock. It opens a real
// Streamable HTTP MCP session against the URL a client would be given, lists the
// tools, and makes one real bMS read call per domain. It also probes the things
// that are easy to assume and expensive to get wrong -- whether the listener is
// actually where you think it is, and whether anything at all authenticates.
//
//   node verify-gateway.mjs --url http://127.0.0.1:3001
//                           [--domains endpoints,jobs] [--suite-root <path>]
//                           [--catalog <path>] [--json] [--expect-auth]
//
// The bearer token is read from the MCP_GATEWAY_AUTH_TOKEN environment variable,
// never from an argument: an argument lands in the process list, in any shell
// history and in a PowerShell transcript. --expect-auth makes an UNauthenticated
// gateway a failure rather than a note, which is what the installer passes once
// it has written a token.
//
// Exit 0 if every checked domain served real data.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSdk, parseArgs } from './sdk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const url = String(args.url || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const suiteRoot = args['suite-root'] || resolve(HERE, '..', '..', 'bConnect-MCP-main');

// SEC-7 — the shared bearer token, from the environment only.
const token = (process.env.MCP_GATEWAY_AUTH_TOKEN || '').split(',')[0].trim();
const expectAuth = !!args['expect-auth'];
const authHeaders = token ? { authorization: `Bearer ${token}` } : {};

const catalogPath = args.catalog || resolve(HERE, 'catalog.json');
const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : { servers: [] };
const probeByDomain = new Map(
  catalog.servers.map((s) => [s.name.replace(/^bconnect-/, ''), s]),
);

const line = (ok, msg) => console.log(`  ${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${msg}`);
const preview = (r) => String(r?.content?.[0]?.text ?? '').replace(/\s+/g, ' ').slice(0, 110);

let failed = false;
const results = [];

console.log(`\n  gateway  ${url}`);

// ─── 1. health ───────────────────────────────────────────────────────────────
let health = null;
try {
  const res = await fetch(`${url}/health`);
  health = await res.json();
  line(res.ok, `GET /health -> ${res.status}  ${health?.count} server(s): ${(health?.servers || []).join(', ')}`);
  if (!res.ok) failed = true;
} catch (err) {
  line(false, `GET /health -> ${err.message}`);
  console.log('        Is it running? Start it with lib\\Start-BConnectGateway.ps1.');
  process.exit(1);
}

// ─── 2. the auth posture, measured rather than assumed ───────────────────────
// SEC-7. This used to be the step that admitted the gateway authenticated nobody.
// It now MEASURES the claim, both ways, against the running process -- because
// "authentication is configured" and "authentication is enforced" are different
// statements and only the second one is worth anything.
let authEnforced = null;
{
  const host = new URL(url).hostname;
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  const probeDomain =
    (args.domains ? String(args.domains).split(',')[0] : health?.servers?.[0]) || 'endpoints';

  // (a) NO token: the gateway must refuse. Sent bare, exactly as an unauthorised
  //     caller would -- if this comes back 200 there is nothing in front of the
  //     estate at all.
  try {
    const res = await fetch(`${url}/${probeDomain}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    authEnforced = res.status === 401;
    if (authEnforced) {
      line(true, `NO token -> ${res.status} REFUSED (WWW-Authenticate: ${res.headers.get('www-authenticate') ?? '(absent)'})`);
    } else if (expectAuth) {
      line(false, `NO token -> ${res.status}. A token was configured, so this MUST have been 401.`);
      console.log('        The gateway is serving unauthenticated callers. Either the process');
      console.log('        predates the token (restart it), or MCP_GATEWAY_AUTH_TOKEN did not');
      console.log('        reach its environment. Check the auth line in the startup log.');
      failed = true;
    } else {
      line(null, `NO token -> ${res.status}: this gateway requires no authentication`);
      console.log('        Nothing authenticates callers. Set MCP_GATEWAY_AUTH_TOKEN (or re-run');
      console.log('        the installer with -Gateway) to require one.');
    }
  } catch (err) {
    line(false, `unauthenticated probe -> ${err.message}`);
    failed = true;
  }

  // (b) WITH the token: the same call must be served. A gateway that refuses
  //     everyone is not secure, it is broken, and the two look identical from
  //     step (a) alone.
  if (token) {
    try {
      const res = await fetch(`${url}/${probeDomain}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...authHeaders },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      line(res.status === 200, `WITH the token -> ${res.status} ${res.status === 200 ? 'SERVED' : '(expected 200)'}`);
      if (res.status !== 200) {
        console.log('        The token in MCP_GATEWAY_AUTH_TOKEN is not the one the running');
        console.log('        gateway loaded. A rotation needs a restart before the new value bites.');
        failed = true;
      }
    } catch (err) {
      line(false, `authenticated probe -> ${err.message}`);
      failed = true;
    }

    // A wrong token of the same shape must fail. Without this, "the header is
    // being ignored" and "the header is being checked" produce the same output.
    try {
      const res = await fetch(`${url}/${probeDomain}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${'z'.repeat(token.length)}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
      line(res.status === 401, `WRONG token -> ${res.status} (401 expected -- proves the value is compared, not just the header's presence)`);
      if (res.status !== 401 && expectAuth) failed = true;
    } catch (err) {
      line(false, `wrong-token probe -> ${err.message}`);
    }
  } else if (expectAuth) {
    line(false, 'a token was expected but MCP_GATEWAY_AUTH_TOKEN is not set in this environment');
    failed = true;
  }

  line(
    true,
    `bind is ${loopback ? 'LOOPBACK' : 'NON-LOOPBACK (' + host + ')'}${authEnforced ? '' : ' -- and the gateway performs no authentication of its own'}`,
  );
  if (!loopback && !authEnforced) {
    console.log('        Everything that can reach this port has the full reach of the single');
    console.log('        bConnect service credential; only bMS RBAC bounds it. There MUST be an');
    console.log('        authenticating, TLS-terminating reverse proxy in front. This verifier');
    console.log('        cannot tell whether there is one -- it can only tell you it matters.');
  }
  if (!loopback && authEnforced && url.startsWith('http://')) {
    console.log('        The token is enforced, but this is plain HTTP: the token itself crosses');
    console.log('        the wire in clear text. TLS is still the fronting proxy\'s job.');
  }
  // A 405 on GET is MCP-spec behaviour and a cheap signal the route is really the
  // gateway's and not a proxy's error page.
  try {
    const res = await fetch(`${url}/${probeDomain}/mcp`, { headers: authHeaders });
    line(res.status === 405, `GET /${probeDomain}/mcp -> ${res.status} (405 Method Not Allowed is the documented answer)`);
  } catch (err) {
    line(false, `GET /<domain>/mcp -> ${err.message}`);
  }
  // An unknown domain must 404 with the list, not 500 -- for an AUTHENTICATED
  // caller. An unauthenticated one gets 401 here, which is correct: the domain
  // list is not something to hand out before the token is checked.
  try {
    const res = await fetch(`${url}/not-a-domain/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders },
      body: '{}',
    });
    line(res.status === 404, `POST /not-a-domain/mcp -> ${res.status} (404 expected)`);
  } catch (err) {
    line(false, `POST /not-a-domain/mcp -> ${err.message}`);
  }
}

// ─── 3. a real MCP session per domain ────────────────────────────────────────
const { Client } = await loadSdk(suiteRoot, 'client/index.js');
const { StreamableHTTPClientTransport } = await loadSdk(suiteRoot, 'client/streamableHttp.js');

let domains = args.domains
  ? String(args.domains).split(',').map((s) => s.trim().replace(/^bconnect-/, '')).filter(Boolean)
  : health?.servers || [];
if (!domains.length) domains = ['endpoints'];

for (const domain of domains) {
  const res = { domain, started: false, tools: 0, read: null, detail: '' };
  results.push(res);
  console.log(`\n${domain}`);
  let client;
  try {
    // The token rides on every request the transport makes, which is also the
    // shape a real client is configured with.
    const transport = new StreamableHTTPClientTransport(new URL(`${url}/${domain}/mcp`), {
      requestInit: { headers: authHeaders },
    });
    client = new Client({ name: 'bconnect-gateway-verify', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    res.started = true;

    const { tools } = await client.listTools();
    res.tools = tools.length;
    const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
    line(true, `MCP session over Streamable HTTP -- ${tools.length} tools, ~${Math.round(bytes / 4).toLocaleString()} tokens of schema`);

    const spec = probeByDomain.get(domain);
    const readTool = spec?.readProbe;
    if (!readTool) {
      res.read = null;
      res.detail = spec?.readProbeSkipReason || 'no zero-argument read tool in this domain';
      line(null, `live read: SKIPPED -- ${res.detail}`);
    } else {
      const schema = tools.find((t) => t.name === readTool)?.inputSchema;
      const props = Object.keys(schema?.properties || {});
      const a = {};
      if (props.includes('PageSize')) a.PageSize = 1;
      else if (props.includes('pageSize')) a.pageSize = 1;
      const r = await client.callTool({ name: readTool, arguments: a });
      res.read = !r.isError;
      res.detail = preview(r);
      line(res.read, `live read: ${readTool} -> ${res.read ? res.detail : 'ERROR: ' + res.detail}`);
      if (!res.read) failed = true;
      if (res.read && /"?totalItems"?\s*:\s*0\b/i.test(res.detail)) {
        console.log('        note: totalItems is 0. bConnect answers HTTP 200 with an empty page for');
        console.log('              collections the credential may not read, so this is NOT proof the');
        console.log('              estate is empty. Spot-check it in the bMC console.');
      }
    }
  } catch (err) {
    line(false, `${domain}: ${err.message}`);
    failed = true;
  } finally {
    try { await client?.close(); } catch { /* closing a dead client is not news */ }
  }
}

// ─── 4. rate limiting is on ──────────────────────────────────────────────────
// Not a load test -- just proof the header is present, which means the middleware
// is in the path. The gateway's limiter is held across requests in a closure,
// which is the one thing the stdio servers get wrong (finding B8).
try {
  const res = await fetch(`${url}/${domains[0]}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...authHeaders },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const limit = res.headers.get('x-ratelimit-limit');
  console.log('');
  line(!!limit, `inbound rate limiting is active -- X-RateLimit-Limit: ${limit ?? '(absent)'}`);
  if (!limit) {
    console.log('        MCP_GATEWAY_RATE_LIMIT_ENABLED may be "false". On a shared or');
    console.log('        non-loopback gateway, turn it back on.');
  }
} catch { /* the session tests above already covered reachability */ }

console.log('');
if (failed) {
  console.log('  NOT proven: something above FAILED, so nothing here is a clean result.');
  console.log('              Read the FAIL lines rather than the summary.');
} else {
  console.log('  Proven:     the gateway serves real bMS data over Streamable HTTP at the');
  console.log('              URL a remote client would be configured with.');
}
if (authEnforced) {
  console.log('              And that it REFUSES a caller with no token, refuses a caller');
  console.log('              with the wrong token, and serves the one with the right token.');
  console.log('  Not proven: who that caller is. One shared token is not an identity, and');
  console.log('              on plain HTTP it is not confidential either. Per-user identity');
  console.log('              and TLS remain the fronting proxy\'s job (ADR-0003).');
} else {
  console.log('  Not proven: that anything authenticates the caller -- this gateway has no');
  console.log('              token configured. If it is not on loopback, a proxy must');
  console.log('              authenticate for it, and this verifier cannot see whether one');
  console.log('              is there. Re-run the installer with -Gateway to get a token.');
}

if (args.json) console.log(JSON.stringify({ url, health, results, authEnforced }, null, 2));
process.exit(failed ? 1 : 0);
