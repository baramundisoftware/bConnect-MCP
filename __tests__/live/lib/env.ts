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
import { join } from 'node:path';
import { parse } from 'dotenv';
import { RELEASES, type Release } from '../../lib/spec.js';

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
  const keys = new Set<string>(PROXY_KEYS);
  for (const file of dirs.flatMap(sourceFiles)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\benv(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g)) {
      const key = m[1] ?? m[2];
      if (CONTROLLED.test(key)) keys.add(key);
    }
  }
  for (const key of FORCED_EMPTY) keys.add(key);
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
  /** Certificates are checked (NODE_TLS_REJECT_UNAUTHORIZED is not 0 in the effective env). */
  tlsVerified: boolean;
  /** BCONNECT_CA_CERT_PATH is set. */
  caFile: boolean;
  /** Values that must never appear in output. */
  secrets: string[];
}

export function loadLiveConfig(args: { root: string; file: string; shell: NodeJS.ProcessEnv }): LiveConfig {
  const { root, file, shell } = args;
  const values = parse(readFileSync(file));
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
    tlsVerified: env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
    caFile: env.BCONNECT_CA_CERT_PATH !== '',
    secrets,
  };
}

/** The environment of a spawned server: the shell without any controlled key, then the live values. */
export function childEnv(config: LiveConfig, shell: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(shell)) {
    if (!(key in config.env) && key !== 'NODE_EXTRA_CA_CERTS' && key !== 'VITEST') env[key] = value;
  }
  return { ...env, ...config.env, NODE_ENV: 'production' };
}

/** Replace every secret of the run in `text`. */
export function redact(config: Pick<LiveConfig, 'secrets'>, text: string): string {
  return config.secrets.reduce((out, secret) => out.split(secret).join('***'), text);
}
