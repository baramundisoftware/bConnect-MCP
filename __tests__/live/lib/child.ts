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

/**
 * Why a server's startup traffic is not just its startup check (plus at most one
 * release detection, #159); empty when it is.
 */
export function startupProblems(requests: LoggedRequest[], domain: string, basePath: string): string[] {
  const problems = requests.filter((r) => r.refused).map((r) => `refused at startup: ${r.method} ${r.path} (${r.refused})`);
  if (problems.length) return problems;
  // Since #159 a server first reads the bMS release: one GET of ManagementServer, no query.
  const detection = `${basePath}/servermanagement/v2.0/ManagementServer`.toLowerCase();
  const isDetection = (r: LoggedRequest) => r.method === 'GET' && r.path.toLowerCase() === detection && r.query === '';
  const detections = requests.filter(isDetection).length;
  if (detections > 1) return [`${detections} release detections at startup, expected at most 1`];
  const checks = requests.filter((r) => !isDetection(r));
  if (checks.length === 0) return ['no startup check was sent'];
  if (checks.length > 1) return [`${checks.length} startup checks, expected 1`];
  const [probe] = checks;
  if (probe.method !== 'GET') return [`startup check is ${probe.method}, not GET`];
  if (!probe.path.toLowerCase().startsWith(`${basePath}/${domain}/`.toLowerCase())) {
    return [`startup check went to ${probe.path}, not the ${domain} API`];
  }
  if (new URLSearchParams(probe.query).get('PageSize') !== '1') return ['startup check without PageSize=1'];
  return [];
}

/**
 * Why a server's startup failed; empty when it passed every check: it answered
 * initialize, listed tools, wrote only JSON-RPC, and sent only its startup check
 * (and at most one release detection).
 * Only a startup with no failure counts as started.
 */
export function startupFailures(
  s: { initialized: boolean; tools: number; nonJson: number; requests: LoggedRequest[] },
  domain: string,
  basePath: string,
): string[] {
  const failures: string[] = [];
  if (!s.initialized) failures.push('no initialize answer');
  if (s.tools === 0) failures.push('tools/list returned no tools');
  if (s.nonJson > 0) failures.push(`${s.nonJson} stdout lines that are not JSON-RPC`);
  return [...failures, ...startupProblems(s.requests, domain, basePath)];
}
