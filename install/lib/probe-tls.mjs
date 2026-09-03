// Ask the runtime that actually carries the traffic why the TLS handshake failed.
//
// A bMS in an offline enterprise almost always presents a certificate signed by an
// internal CA, and that is the single most likely first-run failure of this product.
// Until this file existed it surfaced as "could not connect", identical to a wrong
// URL, a wrong credential, a closed port and a DNS typo -- five different problems
// with five different fixes, reported as one.
//
// Three things make this file the right place for the answer rather than the
// PowerShell caller:
//
//   1. NODE is the arbiter, not Windows. The thirteen servers validate against
//      Node's trust list, which is Node's bundled Mozilla set plus -- only on
//      Node >= 22.15 -- the Windows store (see buildDefaultTrustStore in
//      packages/mcp-core/src/bconnect-client-base.ts). Invoke-WebRequest validates
//      against the Windows store on every Node version. So a certificate from a CA
//      that IS installed in Windows and IS NOT visible to Node passes the installer's
//      HTTP probe and then fails in all thirteen servers. That gap is invisible to
//      any check written in PowerShell.
//   2. The trust construction here is deliberately the same one mcp-core performs,
//      including the part that trips people up: BCONNECT_CA_CERT_PATH REPLACES the
//      trust list, it does not extend it (bconnect-client-base.ts, `config.ca ?? ...`).
//      A PEM holding only the intermediate therefore fails, and the operator has to
//      be told that rather than left to guess.
//   3. The error codes are OpenSSL's, and they are the only signal that separates an
//      untrusted issuer from an expired certificate from a hostname mismatch. Those
//      three need three different actions and only one of them is fixed by a CA file.
//
// One implementation, two consumers: Install-BConnectMcp.ps1 runs this as a CLI and
// prints what it returns; verify-install.mjs imports the classifier to name the same
// causes when it finds an OpenSSL code in a server's stderr. Nothing re-derives it.
//
// Usage:
//   node probe-tls.mjs --url https://bms.example.local/bconnect [--ca <pem>] [--timeout 15000]
//
// Writes one JSON object to stdout. Exit 0 when the chain verifies, 1 otherwise.

import tls from 'node:tls';
import net from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './sdk.mjs';

const DEFAULT_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
// The five codes mcp-core already treats as "chain not trusted", plus the two
// OpenSSL emits when the server did not send its intermediate. mcp-core's set is
// the floor, not the ceiling: it exists to decide whether to append a hint, and it
// classifies nothing else, so an expired certificate and a hostname mismatch both
// fall through it into a bare axios message.
const UNTRUSTED_ISSUER_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
]);

// Codes that mean "TLS spoke, and the certificate is wrong in a way a CA file does
// not repair". Kept separate from the set above because that distinction IS the
// feature: offering the CA prompt for an expired certificate would be a wrong answer
// delivered confidently.
const CAUSE_BY_CODE = new Map([
  ['CERT_HAS_EXPIRED', 'expired'],
  ['CERT_NOT_YET_VALID', 'not-yet-valid'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'hostname-mismatch'],
  ['CERT_REVOKED', 'revoked'],
  ['INVALID_PURPOSE', 'unsupported-purpose'],
  ['INVALID_CA', 'unsupported-purpose'],
  ['CERT_SIGNATURE_FAILURE', 'signature-failure'],
  // Transport, not certificate. Named individually because the whole point is that
  // the operator is told which of these happened.
  ['ENOTFOUND', 'dns'],
  ['EAI_AGAIN', 'dns'],
  ['ECONNREFUSED', 'refused'],
  ['EHOSTUNREACH', 'unreachable'],
  ['ENETUNREACH', 'unreachable'],
  ['ETIMEDOUT', 'timeout'],
  ['ECONNRESET', 'reset'],
  // A TLS client talking to a plain-HTTP listener. Reported as its own cause because
  // the fix is the URL scheme or the port, and it reads like a certificate problem.
  ['EPROTO', 'not-tls-port'],
  ['ERR_SSL_WRONG_VERSION_NUMBER', 'not-tls-port'],
  ['ERR_SSL_PACKET_LENGTH_TOO_LONG', 'not-tls-port'],
]);

/**
 * OpenSSL/Node error code -> one of this file's causes.
 *
 * Exported so verify-install.mjs can name the same cause from a code it scraped out
 * of a server's stderr, where there is no socket left to inspect.
 */
export function classifyTlsFailure(code) {
  const c = String(code || '').trim();
  if (!c) return 'unknown';
  if (UNTRUSTED_ISSUER_CODES.has(c)) return 'untrusted-issuer';
  const mapped = CAUSE_BY_CODE.get(c);
  if (mapped) return mapped;
  // Anything else that came out of the TLS layer at all is still a certificate
  // problem worth separating from "the network did not work".
  if (/^ERR_TLS_/.test(c) || /CERT|SSL/.test(c)) return 'tls-other';
  return 'unknown';
}

/** Every code this file recognises, for callers that need to find one in free text. */
export function knownTlsCodes() {
  return [...UNTRUSTED_ISSUER_CODES, ...CAUSE_BY_CODE.keys()];
}

/** True when supplying a CA certificate is the correct fix for this cause. */
export function isCaFixable(cause) {
  return cause === 'untrusted-issuer';
}

// ---------------------------------------------------------------------------
// Trust list
// ---------------------------------------------------------------------------

/**
 * The trust list mcp-core would build for the same inputs.
 *
 * Deliberately identical in both branches, including the precedence: an explicit CA
 * wins outright and the OS store is not merged in behind it. Diverging here would
 * make this probe pass against a PEM the servers then reject, which is worse than
 * not probing at all.
 */
function buildTrustList(caPath) {
  if (caPath) return { ca: readFileSync(caPath, 'utf8'), source: 'ca-file' };

  const getCACertificates = tls.getCACertificates;
  if (typeof getCACertificates !== 'function') {
    return { ca: undefined, source: 'node-bundle' };   // Node < 22.15
  }
  try {
    const merged = [...getCACertificates('default'), ...getCACertificates('system')];
    return merged.length
      ? { ca: merged, source: 'node-bundle+os-store' }
      : { ca: undefined, source: 'node-bundle' };
  } catch {
    return { ca: undefined, source: 'node-bundle' };
  }
}

/** True when this Node runtime can see the Windows certificate store. */
export function nodeReadsOsStore() {
  return typeof tls.getCACertificates === 'function';
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

const cn = (name) => (name && (name.CN || name.O)) || '';

/**
 * Subject, issuer, validity and chain shape of whatever the server presented.
 * Read from the socket, never from a file, so it describes the live deployment.
 */
function peerFacts(socket) {
  const leaf = socket.getPeerCertificate(true);
  if (!leaf || !leaf.subject) return null;

  const chain = [];
  const seen = new Set();
  let node = leaf;
  while (node && node.fingerprint256 && !seen.has(node.fingerprint256)) {
    seen.add(node.fingerprint256);
    chain.push({ subject: cn(node.subject), issuer: cn(node.issuer) });
    if (node.issuerCertificate === node) break;   // self-signed root terminates the walk
    node = node.issuerCertificate;
  }

  return {
    subject: cn(leaf.subject),
    issuer: cn(leaf.issuer),
    validFrom: leaf.valid_from || '',
    validTo: leaf.valid_to || '',
    altNames: leaf.subjectaltname || '',
    chain,
    // Its own issuer at depth zero: there is no separate CA to obtain, the
    // certificate itself has to become the anchor.
    selfSigned: cn(leaf.subject) !== '' && cn(leaf.subject) === cn(leaf.issuer),
    // The server sent the leaf alone. The issuing CA is not on the wire, so no
    // amount of trust configuration can complete the chain from what arrived.
    leafOnly: chain.length === 1 && cn(leaf.subject) !== cn(leaf.issuer),
  };
}

/** RFC 6066 forbids an IP literal as the SNI server name, and Node warns about it. */
const isIpLiteral = (host) => /^[0-9.]+$/.test(host) || host.includes(':');

function connectOnce({ host, port, ca, rejectUnauthorized, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      try { socket?.destroy(); } catch { /* already gone */ }
      resolve(r);
    };

    try {
      const options = { host, port, ca, rejectUnauthorized };
      if (!isIpLiteral(host)) options.servername = host;
      socket = tls.connect(options, () => {
        finish({ ok: true, peer: peerFacts(socket) });
      });
    } catch (err) {
      finish({ ok: false, code: err.code || '', message: String(err.message || err) });
      return;
    }

    socket.setTimeout(timeoutMs, () => {
      finish({ ok: false, code: 'ETIMEDOUT', message: `no TLS handshake within ${timeoutMs} ms` });
    });
    socket.on('error', (err) => {
      // Node reports the OpenSSL code on the error itself for verification
      // failures, and under `cause` for some wrapped socket errors.
      const code = err.code || err.cause?.code || '';
      finish({ ok: false, code, message: String(err.message || err), peer: safePeer(socket) });
    });
  });
}

/** Reachability without TLS, for an http:// base URL. Opened, proven, dropped. */
function tcpProbe({ host, port, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* already gone */ }
      resolve(r);
    };
    const socket = net.connect({ host, port }, () => finish({ ok: true }));
    socket.setTimeout(timeoutMs, () => finish({ ok: false, code: 'ETIMEDOUT', message: `no connection within ${timeoutMs} ms` }));
    socket.on('error', (err) => finish({ ok: false, code: err.code || '', message: String(err.message || err) }));
  });
}

/** getPeerCertificate on a failed socket throws on some Node builds; it is optional detail. */
function safePeer(socket) {
  try { return peerFacts(socket); } catch { return null; }
}

/**
 * Verify `url` the way the servers will, and -- when that fails -- describe what was
 * on the wire well enough to name the fix.
 */
export async function probeTls({ url, caPath, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return finalize({ cause: 'bad-url', code: '', message: `'${url}' is not a URL`, url });
  }

  const host = parsed.hostname;
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));

  if (parsed.protocol !== 'https:') {
    // No certificate to judge, but the caller still needs DNS and the port told
    // apart from each other, so the plain socket is opened and dropped.
    const tcp = await tcpProbe({ host, port, timeoutMs });
    if (!tcp.ok) {
      return finalize({ cause: classifyTlsFailure(tcp.code), code: tcp.code, message: tcp.message, url, host, port, caPath });
    }
    return finalize({ cause: 'not-tls', code: '', message: '', url, host, port, caPath });
  }

  let trust;
  try {
    trust = buildTrustList(caPath);
  } catch (err) {
    return finalize({
      cause: 'ca-file-unreadable', code: err.code || '', message: String(err.message || err),
      url, host, port, caPath,
    });
  }

  const verified = await connectOnce({
    host, port, ca: trust.ca, rejectUnauthorized: true, timeoutMs,
  });
  if (verified.ok) {
    return finalize({ cause: 'trusted', code: '', message: '', url, host, port, caPath, trustSource: trust.source, peer: verified.peer });
  }

  let peer = verified.peer || null;
  const cause = classifyTlsFailure(verified.code);

  // A second handshake, with verification off, PURELY to read the certificate that
  // is already being rejected. Nothing is sent on it and the socket is destroyed in
  // the callback: it is a diagnostic read of the same bytes the failed handshake
  // already received, not a fallback path and not an option offered to anyone. It
  // runs only when the failure was a certificate failure, so a refused port or a
  // DNS miss never reaches it.
  if (!peer && cause !== 'dns' && cause !== 'refused' && cause !== 'unreachable' &&
      cause !== 'timeout' && cause !== 'not-tls-port' && cause !== 'reset') {
    const inspected = await connectOnce({ host, port, ca: undefined, rejectUnauthorized: false, timeoutMs });
    peer = inspected.peer || null;
  }

  return finalize({
    cause, code: verified.code, message: verified.message,
    url, host, port, caPath, trustSource: trust.source, peer,
  });
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------
// The strings below are what an administrator reads. State the condition, the
// consequence and the action. `remedy` is an ordered list of things to do;
// `warning` is never an action and must never be rendered as one.

const CA_PROMPT_LINE =
  'Export the issuing CA certificate in PEM form (Base-64 encoded X.509) and supply its ' +
  'path. It is recorded as BCONNECT_CA_CERT_PATH and every server reads it.';

const CA_WHOLE_CHAIN_LINE =
  'The file must contain every certificate above the bMS certificate: the issuing CA, and ' +
  'the root above it where the CA is not itself the root. BCONNECT_CA_CERT_PATH replaces ' +
  'the trust list rather than adding to it, so a partial file fails.';

const REJECT_UNAUTHORIZED_NOTE =
  'NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate verification for every connection ' +
  'the process makes, including the ones carrying the bMS credential. It is a development ' +
  'flag. This installer does not set it and does not offer it.';

function daysUntil(dateText) {
  const t = Date.parse(dateText);
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86400000);
}

function certLines(peer) {
  // Silence rather than a placeholder. There is no certificate to describe when the
  // socket never got one, and when verify-install.mjs calls this it has only a code
  // scraped out of stderr -- a line saying the certificate could not be read would
  // be reporting on something that was never attempted.
  if (!peer) return [];
  const out = [];
  out.push(`Certificate subject: ${peer.subject || '(no common name)'}`);
  out.push(`Issued by:           ${peer.issuer || '(no common name)'}`);
  if (peer.validFrom || peer.validTo) out.push(`Valid:               ${peer.validFrom} to ${peer.validTo}`);
  if (peer.altNames) out.push(`Names on it:         ${peer.altNames}`);
  out.push(`Chain presented:     ${peer.chain.length} certificate(s)`);
  return out;
}

/**
 * Turn a probe result into the headline, the detail and the ordered remedy the
 * console and the wizard both render. Pure, so it is testable without a socket.
 */
export function describeTlsResult(r) {
  const peer = r.peer;
  // verify-install.mjs reaches this with a code scraped out of a server's stderr and
  // no socket behind it, so there is no host to name.
  const where = r.host ? `${r.host}:${r.port}` : 'the configured bConnect base URL';
  const codeSuffix = r.code ? ` (${r.code})` : '';
  const osStore = nodeReadsOsStore();

  switch (r.cause) {
    case 'trusted': {
      const detail = certLines(peer);
      const left = peer ? daysUntil(peer.validTo) : null;
      if (left !== null && left <= 30) {
        detail.push(`This certificate expires in ${left} day(s). Renew it before then or every server stops connecting.`);
      }
      if (r.caPath) detail.push(`Verified against the supplied CA file, which is what the servers will use.`);
      return {
        headline: `The certificate presented by ${where} is trusted by this Node runtime.`,
        detail, remedy: [], warning: '', caFixable: false,
      };
    }

    case 'not-tls':
      return {
        headline: `${where} is addressed over http://, so no certificate is involved.`,
        detail: ['The API key and the password cross the network in clear text on this URL.'],
        remedy: ['Publish bConnect over https:// and change the base URL to match.'],
        warning: '', caFixable: false,
      };

    case 'untrusted-issuer': {
      const detail = certLines(peer);
      if (peer?.selfSigned) {
        detail.push('The certificate is self-signed: it is its own issuer. There is no separate CA to obtain, so the certificate itself is the file to supply.');
      } else if (peer?.leafOnly) {
        detail.push('The server sent its own certificate and nothing above it. The issuing CA is not on the wire, so the chain cannot be completed from what arrived.');
      }
      if (r.caPath) {
        // The re-probe after a supplied file. Saying only "not trusted" a second
        // time reads as though the file was ignored, and the operator starts
        // looking at the installer instead of at the file.
        detail.push(`The supplied file was used as the whole trust list and did not verify this chain: ${r.caPath}`);
      } else {
        detail.push(
          osStore
            ? 'This Node runtime reads the Windows certificate store, and the issuer is not in that store either.'
            : `This Node runtime (${process.version}) does not read the Windows certificate store, so a CA installed in Windows is invisible to it.`
        );
      }
      const remedy = r.caPath
        ? [
            'The file supplied is not the certificate that signed this one. Export the issuing CA again from the authority that issued the bMS certificate.',
            CA_WHOLE_CHAIN_LINE,
          ]
        : [CA_PROMPT_LINE, CA_WHOLE_CHAIN_LINE];
      if (!osStore) {
        remedy.push('Node 22.15 or newer reads the Windows certificate store. On that runtime, installing the CA into the machine store removes this step.');
      } else {
        remedy.push('Installing the CA into the Windows machine store is the alternative, and this runtime would then pick it up without a file.');
      }
      return {
        headline: `The bMS certificate at ${where} was presented, and its issuer is not trusted${codeSuffix}.`,
        detail, remedy, warning: REJECT_UNAUTHORIZED_NOTE, caFixable: true,
      };
    }

    case 'expired': {
      const detail = certLines(peer);
      detail.push(`The clock on this computer reads ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC.`);
      return {
        headline: `The bMS certificate at ${where} has expired${codeSuffix}.`,
        detail,
        remedy: [
          'Renew the certificate on the bMS and restart its web service. A CA certificate does not make an expired certificate valid.',
          'If the certificate is in fact current, the clock on this computer is wrong. Correct the time and re-run.',
        ],
        warning: '', caFixable: false,
      };
    }

    case 'not-yet-valid': {
      const detail = certLines(peer);
      detail.push(`The clock on this computer reads ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC.`);
      return {
        headline: `The bMS certificate at ${where} is not valid yet${codeSuffix}.`,
        detail,
        remedy: [
          'Correct the clock on this computer. A clock that runs behind is the usual cause, and it affects every certificate this machine checks.',
          'If the time is right, the certificate was issued with a future start date and has to be reissued.',
        ],
        warning: '', caFixable: false,
      };
    }

    case 'hostname-mismatch': {
      const detail = certLines(peer);
      detail.push(`The base URL asks for the name '${r.host}', which is not among them.`);
      return {
        headline: `The bMS certificate at ${where} is trusted but was not issued for '${r.host}'${codeSuffix}.`,
        detail,
        remedy: [
          'Change the base URL to a name the certificate carries. An IP address in the base URL is the common cause, because certificates are rarely issued for one.',
          `Or reissue the bMS certificate with '${r.host}' in its Subject Alternative Name.`,
          'A CA certificate file does not fix this. The issuer is already trusted; the name is what does not match.',
        ],
        warning: '', caFixable: false,
      };
    }

    case 'revoked':
      return {
        headline: `The bMS certificate at ${where} has been revoked${codeSuffix}.`,
        detail: certLines(peer),
        remedy: ['Issue a new certificate for the bMS and install it. A revoked certificate is not made usable by any client-side setting.'],
        warning: '', caFixable: false,
      };

    case 'unsupported-purpose':
      return {
        headline: `The certificate chain at ${where} is not usable for server authentication${codeSuffix}.`,
        detail: certLines(peer),
        remedy: [
          'Reissue the bMS certificate from a template that carries the Server Authentication extended key usage.',
          'Where a CA file was supplied, confirm it holds a CA certificate rather than a copy of the server certificate.',
        ],
        warning: '', caFixable: false,
      };

    case 'signature-failure':
      return {
        headline: `The signature on the certificate at ${where} did not verify${codeSuffix}.`,
        detail: certLines(peer),
        remedy: [
          'The supplied CA is not the CA that signed this certificate, or the chain has been re-signed. Export the CA again from the issuing authority.',
        ],
        warning: '', caFixable: false,
      };

    case 'ca-file-unreadable':
      return {
        headline: `The CA certificate file could not be read: ${r.caPath}`,
        detail: [r.message],
        remedy: [
          'Give the full path to a readable PEM file. A .cer exported as DER is not PEM; re-export it as Base-64 encoded X.509.',
        ],
        warning: '', caFixable: true,
      };

    case 'not-tls-port':
      return {
        headline: `${where} did not answer with TLS${codeSuffix}.`,
        detail: ['The base URL is https://, and what answered on that port is not a TLS listener.'],
        remedy: [
          'Confirm the port in the base URL. A bConnect published on plain HTTP answers this way when addressed as https://.',
          'Confirm that a proxy or a load balancer in front of the bMS is terminating TLS on this port.',
        ],
        warning: '', caFixable: false,
      };

    case 'dns':
      return {
        headline: `The name '${r.host}' did not resolve${codeSuffix}.`,
        detail: ['No connection was attempted, so nothing is known about the certificate or the credential.'],
        remedy: [
          'Check the spelling of the host name in the base URL.',
          'Check that this computer uses a DNS server that knows the bMS. A short name may need the domain suffix appended.',
        ],
        warning: '', caFixable: false,
      };

    case 'refused':
      return {
        headline: `${where} refused the connection${codeSuffix}.`,
        detail: ['The name resolved and the host answered, so this is the port rather than the address.'],
        remedy: [
          'Check the port in the base URL against the port bConnect is published on.',
          'Check that the bConnect web service is running on the bMS.',
        ],
        warning: '', caFixable: false,
      };

    case 'unreachable':
      return {
        headline: `${where} could not be reached${codeSuffix}.`,
        detail: ['The name resolved and no route to the host was available.'],
        remedy: ['Check routing and firewall rules between this computer and the bMS.'],
        warning: '', caFixable: false,
      };

    case 'timeout':
      return {
        headline: `${where} did not complete a TLS handshake in time${codeSuffix}.`,
        detail: ['A firewall that drops rather than rejects produces exactly this, as does a bMS under heavy load.'],
        remedy: [
          'Check for a firewall between this computer and the bMS that discards packets silently.',
          'Re-run when the bMS is not busy. Nothing has been written.',
        ],
        warning: '', caFixable: false,
      };

    case 'reset':
      return {
        headline: `${where} closed the connection during the handshake${codeSuffix}.`,
        detail: ['A TLS version or cipher mismatch, or an inspecting proxy, produces this.'],
        remedy: [
          'Check whether a TLS-inspecting proxy sits between this computer and the bMS. Where one does, its CA is the certificate to supply.',
          'Check the TLS versions the bMS accepts.',
        ],
        warning: '', caFixable: false,
      };

    case 'bad-url':
      return {
        headline: r.message,
        detail: [],
        remedy: ['Supply a base URL of the form https://bms.example.local/bconnect.'],
        warning: '', caFixable: false,
      };

    default:
      return {
        headline: `The connection to ${where} failed${codeSuffix}: ${r.message}`,
        detail: certLines(peer),
        remedy: ['Record the code above before re-running. It is what separates a certificate problem from a network problem.'],
        warning: '', caFixable: false,
      };
  }
}

function finalize(r) {
  const described = describeTlsResult(r);
  return {
    ...r,
    nodeVersion: process.version,
    nodeReadsOsStore: nodeReadsOsStore(),
    peer: r.peer ?? null,
    ...described,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error('probe-tls: --url <url> is required');
    process.exit(2);
  }
  const result = await probeTls({
    url: String(args.url),
    caPath: args.ca ? String(args.ca) : undefined,
    timeoutMs: args.timeout ? Number(args.timeout) : DEFAULT_TIMEOUT_MS,
  });
  // --out exists because the PowerShell caller runs this through a helper that
  // merges stdout and stderr, and Node writes deprecation notices to stderr. A
  // file cannot be corrupted by that interleaving; stdout can.
  const json = JSON.stringify(result);
  if (args.out) writeFileSync(String(args.out), json, 'utf8');
  else process.stdout.write(json);
  process.exit(result.cause === 'trusted' || result.cause === 'not-tls' ? 0 : 1);
}
