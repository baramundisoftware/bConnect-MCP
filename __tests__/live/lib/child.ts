/**
 * The spawned servers of the live tier run under child-guard.mjs, which logs
 * every request they send. At startup a server may send exactly one request: its
 * startup check, a GET list request of its own API domain with PageSize=1.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The preload, as a file URL (`node --import` needs one on Windows). */
export const CHILD_GUARD = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'child-guard.mjs')).href;

export interface LoggedRequest { method: string; path: string; query: string; refused?: string }

function isLoggedRequest(value: unknown): value is LoggedRequest {
  return typeof value === 'object' && value !== null && 'method' in value && 'path' in value && 'query' in value;
}

export function readGuardLog(file: string): LoggedRequest[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line): LoggedRequest => {
    const parsed: unknown = JSON.parse(line);
    if (!isLoggedRequest(parsed)) throw new Error(`child-guard log line is not a request: ${line}`);
    return parsed;
  });
}

/** Why a server's startup traffic is not just its startup check; empty when it is. */
export function startupProblems(requests: LoggedRequest[], domain: string, basePath: string): string[] {
  const problems = requests.filter((r) => r.refused).map((r) => `refused at startup: ${r.method} ${r.path} (${r.refused})`);
  if (problems.length) return problems;
  if (requests.length === 0) return ['no startup check was sent'];
  if (requests.length > 1) return [`${requests.length} requests at startup, expected 1`];
  const [probe] = requests;
  if (probe.method !== 'GET') return [`startup check is ${probe.method}, not GET`];
  if (!probe.path.toLowerCase().startsWith(`${basePath}/${domain}/`.toLowerCase())) {
    return [`startup check went to ${probe.path}, not the ${domain} API`];
  }
  if (new URLSearchParams(probe.query).get('PageSize') !== '1') return ['startup check without PageSize=1'];
  return [];
}
