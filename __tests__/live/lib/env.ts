/**
 * The environment of a live run, built only from the live env file.
 *
 * Every variable a server or the shared core reads (connection, credentials, TLS,
 * audit, rate limit, transport, gates) is set explicitly: from the file, or empty.
 * Empty, not deleted: dotenv never overrides a key that is present, so neither the
 * repo `.env` nor the shell can add a CA, an API key or a TLS switch to the run.
 * The keys are found in the source, not listed by hand.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { RELEASES, type Release } from '../../lib/spec.js';
import { envReads } from '../../lib/env-reads.js';
import { declared, type Declared } from './profile.js';

/** Proxy variables axios honors; a shell proxy must not reroute the run. */
const PROXY_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];
/** Gates and switches the file must not touch; they are always empty (closed, probe on, stdio). */
const FORCED_EMPTY = ['ALLOW_WRITE_OPERATIONS', 'ALLOW_SECRET_READ', 'BCONNECT_SKIP_CONNECTIVITY_CHECK', 'MCP_TRANSPORT'];
const CONTROLLED = /^(BCONNECT_|ALLOW_|MCP_|NODE_TLS_REJECT_UNAUTHORIZED$)/;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'generated' ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

/** The variables the live run sets: every one the servers and core read, plus the proxy variables. */
export function controlledKeys(root: string): string[] {
  const dirs = [
    ...readdirSync(root).filter((d) => /^bconnect-.+-mcp$/.test(d) && d !== 'bconnect-mcp-gateway').map((d) => join(root, d, 'src')),
    join(root, 'packages', 'mcp-core', 'src'),
  ];
  return controlledKeysIn(dirs.flatMap(sourceFiles).map((file) => ({ file, text: readFileSync(file, 'utf8') })));
}

/**
 * The controlled keys among the environment reads in `sources`, found with the
 * shared parser (__tests__/lib/env-reads.ts): names in comments and strings don't
 * count. A read whose name can't be known fails the run, because the run couldn't
 * set that variable.
 */
export function controlledKeysIn(sources: Array<{ file: string; text: string }>): string[] {
  const keys = new Set<string>([...PROXY_KEYS, ...FORCED_EMPTY]);
  for (const { file, text } of sources) {
    for (const read of envReads(text, file)) {
      if (read.name === null) throw new LiveConfigError(`${file}:${read.line} reads the environment with a name the live run can't know: ${read.text}`);
      if (CONTROLLED.test(read.name)) keys.add(read.name);
    }
  }
  return [...keys].sort();
}

export class LiveConfigError extends Error {
  constructor(message: string) {
    super(`live tier: ${message}`);
    this.name = 'LiveConfigError';
  }
}

export interface LiveConfig {
  file: string;
  /** The value of every controlled key, as servers in this run see it. */
  env: Record<string, string>;
  baseUrl: URL;
  release: Release;
  /** HTTPS with certificates checked (NODE_TLS_REJECT_UNAUTHORIZED is not 0 in the effective env). */
  tlsVerified: boolean;
  /** The base URL is http: no TLS at all (the servers refuse it unless BCONNECT_ALLOW_INSECURE_HTTP is set). */
  plainHttp: boolean;
  /** BCONNECT_CA_CERT_PATH is set. */
  caFile: boolean;
  /** What the operator declares about the bMS; the API can't tell (lib/profile.ts). */
  declared: { mdm: Declared; entraId: Declared };
  /** Values that must never appear in output. */
  secrets: string[];
}

export function loadLiveConfig(args: { root: string; file: string; shell: NodeJS.ProcessEnv }): LiveConfig {
  const { root, file, shell } = args;
  if (!existsSync(file)) throw new LiveConfigError(`the env file ${file} does not exist (set BCONNECT_LIVE_ENV or create .env.local)`);
  const values = parse(readFileSync(file));
  if (!values.BCONNECT_BASE_URL) throw new LiveConfigError(`${file} sets no BCONNECT_BASE_URL`);
  if (!URL.canParse(values.BCONNECT_BASE_URL) || !/^https?:$/.test(new URL(values.BCONNECT_BASE_URL).protocol)) {
    throw new LiveConfigError(`BCONNECT_BASE_URL in ${file} is not an http(s) URL`);
  }
  if (values.BCONNECT_CA_CERT_PATH && !existsSync(values.BCONNECT_CA_CERT_PATH)) {
    throw new LiveConfigError(`BCONNECT_CA_CERT_PATH in ${file} names a file that does not exist`);
  }
  for (const key of FORCED_EMPTY) {
    if (values[key]) throw new LiveConfigError(`${file} must not set ${key}: the live run keeps writes, secrets and the startup check fixed`);
  }
  if (shell.NODE_EXTRA_CA_CERTS) {
    throw new LiveConfigError('NODE_EXTRA_CA_CERTS is set in the shell and cannot be dropped for this process; unset it and use BCONNECT_CA_CERT_PATH in the env file');
  }
  const env: Record<string, string> = {};
  for (const key of controlledKeys(root)) env[key] = FORCED_EMPTY.includes(key) ? '' : values[key] ?? '';

  const release = RELEASES.find((r) => r === (env.BCONNECT_RELEASE || '26R1'));
  if (!release) throw new LiveConfigError(`BCONNECT_RELEASE must be one of ${RELEASES.join(', ')}`);
  env.BCONNECT_RELEASE = release;

  const secrets = [env.BCONNECT_PASSWORD, env.BCONNECT_API_KEY,
    env.BCONNECT_USERNAME && env.BCONNECT_PASSWORD
      ? Buffer.from(`${env.BCONNECT_USERNAME}:${env.BCONNECT_PASSWORD}`).toString('base64') : '',
  ].filter((s) => s.length >= 4);

  return {
    file,
    env,
    baseUrl: new URL(env.BCONNECT_BASE_URL),
    release,
    tlsVerified: new URL(env.BCONNECT_BASE_URL).protocol === 'https:' && env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    plainHttp: new URL(env.BCONNECT_BASE_URL).protocol === 'http:',
    caFile: env.BCONNECT_CA_CERT_PATH !== '',
    declared: { mdm: declared(values.BCONNECT_LIVE_MDM), entraId: declared(values.BCONNECT_LIVE_ENTRA_ID) },
    secrets,
  };
}

/**
 * One authenticated GET of `<base>/info`, with the run's TLS settings. Any HTTP
 * answer proves the bMS is reachable; the bMS version comes back when the
 * credentials work. Network and TLS errors fail the run. The host stays out of
 * the message.
 */
export function checkReachable(config: LiveConfig): Promise<{ status: number; bmsVersion?: string }> {
  const { env } = config;
  const url = new URL(`${config.baseUrl.href.replace(/\/$/, '')}/info`);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (env.BCONNECT_API_KEY) headers['X-Api-Key'] = env.BCONNECT_API_KEY;
  else if (env.BCONNECT_USERNAME) headers.Authorization = `Basic ${Buffer.from(`${env.BCONNECT_USERNAME}:${env.BCONNECT_PASSWORD}`).toString('base64')}`;
  const options: https.RequestOptions = {
    method: 'GET', headers, timeout: 15_000,
    rejectUnauthorized: env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    ...(config.caFile && { ca: readFileSync(env.BCONNECT_CA_CERT_PATH) }),
  };
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, options, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { text += d; });
      res.on('end', () => {
        let bmsVersion: string | undefined;
        try { const v: unknown = JSON.parse(text)?.bMSVersion; if (typeof v === 'string') bmsVersion = v; } catch { /* not JSON */ }
        resolve({ status: res.statusCode ?? 0, bmsVersion });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e: NodeJS.ErrnoException) => reject(new LiveConfigError(`the bMS is not reachable (${e.code ?? e.message}); check BCONNECT_BASE_URL, the network and the TLS settings in ${config.file}`)));
    req.end();
  });
}

/** The environment of a spawned server: the shell without any controlled key, then the live values. */
export function childEnv(config: LiveConfig, shell: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(shell)) {
    if (!(key in config.env) && key !== 'NODE_EXTRA_CA_CERTS' && key !== 'VITEST') env[key] = value;
  }
  return { ...env, ...config.env, NODE_ENV: 'production' };
}
