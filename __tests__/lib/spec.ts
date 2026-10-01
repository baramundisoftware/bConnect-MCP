/**
 * The bConnect API operations of each release, read from the bundled OpenAPI
 * specs (`openapi-specs/<release>/*.json`). Shared by the guard tests; nothing
 * here is a hand-written list of routes or tools.
 *
 * Secret classification:
 * An operation is secret-bearing when one of its 2xx response schemas contains a
 * STRING field whose name contains one of SECRET_KEYWORDS (case-insensitive).
 * Substring, because the API uses camelCase (`initialStartupPin`); string-only,
 * because status flags such as `isStartupPinEnabled` are booleans, not secrets.
 *
 * The answer is recomputed on every run (REQ-SRV-017, ADR-0004).
 *
 * Contract data for the spec-conformance guard (REQ-QA-001): operationId,
 * summary, query parameters, request bodies per content type, and whether a 2xx
 * response declares a body.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASES = ['25R2', '26R1'] as const;
export type Release = (typeof RELEASES)[number];

export const SECRET_KEYWORDS = [
  'pin', 'password', 'recoverykey', 'secret', 'token', 'apikey', 'privatekey', 'credential',
] as const;

export interface ApiOperation {
  release: Release;
  domain: string;          // lower-case spec name, e.g. "defensecontrol" (= URL segment)
  method: string;          // upper-case HTTP method
  path: string;            // spec path template, e.g. /v2.0/BitLocker/WindowsEndpoints/{id}/Secrets
  operationId: string;
  summary: string;
  secretFields: string[];  // e.g. ["BitLockerSecrets.initialStartupPin"]; empty = not secret-bearing
  queryParams: string[];   // names of the query parameters the operation accepts, e.g. ["Page", "PageSize"]
  requestBodies: Record<string, Schema>;  // content type → schema (may be a $ref into the spec)
  bodyRequired: boolean;   // requestBody.required
  returnsBody: boolean;    // a 2xx response declares content
  spec: Schema;            // the whole spec document, for resolving $refs
  matches(method: string, path: string): boolean;
}

export type Schema = Record<string, any>;

const SPEC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'openapi-specs');
const cache = new Map<Release, ApiOperation[]>();

function isStringType(type: unknown): boolean {
  return type === 'string' || (Array.isArray(type) && type.includes('string'));
}

/** Walk a response schema and return every credential-shaped string field. */
function secretFieldsOf(schema: Schema | undefined, schemas: Record<string, Schema>): string[] {
  const hits = new Set<string>();
  const visited = new Set<string>();
  const walk = (sc: Schema | undefined, owner: string): void => {
    if (!sc) return;
    if (sc.$ref) {
      const name = String(sc.$ref).split('/').pop()!;
      if (visited.has(name)) return;
      visited.add(name);
      walk(schemas[name], name);
      return;
    }
    for (const part of [...(sc.allOf ?? []), ...(sc.oneOf ?? []), ...(sc.anyOf ?? [])]) walk(part, owner);
    if (sc.items) walk(sc.items, owner);
    for (const [field, def] of Object.entries<Schema>(sc.properties ?? {})) {
      const lower = field.toLowerCase();
      if (isStringType(def.type) && SECRET_KEYWORDS.some((k) => lower.includes(k))) {
        hits.add(`${owner}.${field}`);
      }
      walk(def, owner);
    }
  };
  walk(schema, 'response');
  return [...hits];
}

/** Every operation of every spec of a release, with its secret classification. */
export function loadOperations(release: Release): ApiOperation[] {
  const cached = cache.get(release);
  if (cached) return cached;
  const ops: ApiOperation[] = [];
  const dir = join(SPEC_ROOT, release);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    // 25R2 and 26R1 spell the file names differently (DefenseControl / Defensecontrol).
    const domain = file.replace(/^bConnect_/, '').replace(/\.json$/, '').toLowerCase();
    const spec = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const schemas: Record<string, Schema> = spec.components?.schemas ?? {};
    for (const [path, byMethod] of Object.entries<Schema>(spec.paths ?? {})) {
      const pattern = new RegExp('^' + path.replace(/\{[^}]+\}/g, '[^/]+') + '/?$');
      for (const [method, op] of Object.entries<Schema>(byMethod)) {
        if (!op || typeof op !== 'object' || !op.responses) continue;
        const fields = new Set<string>();
        for (const [code, response] of Object.entries<Schema>(op.responses)) {
          if (!/^2/.test(code)) continue;
          for (const media of Object.values<Schema>(response.content ?? {})) {
            for (const f of secretFieldsOf(media.schema, schemas)) fields.add(f);
          }
        }
        const upper = method.toUpperCase();
        const requestBodies: Record<string, Schema> = {};
        for (const [type, media] of Object.entries<Schema>(op.requestBody?.content ?? {})) {
          requestBodies[type] = media.schema ?? {};
        }
        const returnsBody = Object.entries<Schema>(op.responses)
          .some(([code, response]) => /^2/.test(code) && Object.keys(response.content ?? {}).length > 0);
        ops.push({
          release, domain, method: upper, path, operationId: op.operationId ?? '',
          summary: op.summary ?? '',
          secretFields: [...fields],
          requestBodies, bodyRequired: op.requestBody?.required === true, returnsBody, spec,
          queryParams: (op.parameters ?? []).filter((q: Schema) => q.in === 'query').map((q: Schema) => q.name),
          matches: (m, p) => m.toUpperCase() === upper && pattern.test(p),
        });
      }
    }
  }
  cache.set(release, ops);
  return ops;
}

export function secretBearingOperations(release: Release): ApiOperation[] {
  return loadOperations(release).filter((op) => op.secretFields.length > 0);
}

/**
 * Resolve a request as sent by a server to its spec operation.
 * `requestPath` is the URL path below the configured base URL, e.g.
 * `/defensecontrol/v2.0/BitLocker/WindowsEndpoints/<id>/Secrets`.
 */
export function findOperation(release: Release, method: string, requestPath: string): ApiOperation | undefined {
  const m = /^\/([^/]+)(\/.*)$/.exec(requestPath);
  if (!m) return undefined;
  const [, domain, rest] = m;
  return loadOperations(release).find((op) => op.domain === domain.toLowerCase() && op.matches(method, rest));
}

/** The operation with this operationId in the release, or undefined. */
export function operationById(release: Release, operationId: string): ApiOperation | undefined {
  return loadOperations(release).find((op) => op.operationId === operationId);
}
