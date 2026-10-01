/**
 * Request-body validation against the OpenAPI specs, for the spec-conformance
 * guard (REQ-QA-001 AC 4).
 *
 * JSON bodies are validated with ajv against the operation's `requestBody`
 * schema. Two spec quirks are handled explicitly:
 * - OpenAPI 3.0 `nullable` (also on `$ref`/`allOf`, which JSON Schema can't
 *   express) is rewritten to `type: [T, 'null']` or `anyOf [..., null]`.
 * - JSON Patch bodies (`application/json-patch+json`) are checked against the
 *   JSON Patch format (RFC 6902): an array of operations with a known `op` and
 *   a `path` starting with "/". The specs type each operation's `value` as an
 *   object, which a valid patch replacing a string or number would fail; that
 *   is a generator artefact, not the API contract.
 */
import { createRequire } from 'node:module';
import type { Ajv as AjvInstance, ValidateFunction } from 'ajv';
import { type ApiOperation, type Release, type Schema, loadOperations } from './spec.js';

// ajv and ajv-formats are CommonJS; under Node16 module resolution their default
// exports don't type-check as ESM default imports, so they are loaded with require.
const require = createRequire(import.meta.url);
const { Ajv } = require('ajv') as { Ajv: typeof AjvInstance };
const addFormats = require('ajv-formats') as (ajv: AjvInstance) => AjvInstance;

export const JSON_PATCH = 'application/json-patch+json';

/** OpenAPI 3.0 `nullable` → JSON Schema. */
export function withoutNullable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutNullable);
  if (!node || typeof node !== 'object') return node;
  const out: Schema = {};
  for (const [k, v] of Object.entries(node)) out[k] = withoutNullable(v);
  if (out.nullable !== true) {
    delete out.nullable;
    return out;
  }
  delete out.nullable;
  if (typeof out.type === 'string') return { ...out, type: [out.type, 'null'] };
  return { anyOf: [out, { type: 'null' }] };
}

const PATCH_OPS = /^(add|remove|replace|move|copy|test)$/i;

/** Problems with a JSON Patch document; empty when it is well-formed. */
export function jsonPatchProblems(data: unknown): string[] {
  if (!Array.isArray(data)) return ['not a JSON Patch array'];
  return data.flatMap((op: Schema, i: number) => {
    if (!op || typeof op !== 'object') return [`/${i} is not an operation`];
    const problems: string[] = [];
    if (!PATCH_OPS.test(String(op.op))) problems.push(`/${i}/op is not a JSON Patch operation`);
    if (typeof op.path !== 'string' || !op.path.startsWith('/')) problems.push(`/${i}/path must start with "/"`);
    return problems;
  });
}

const escapePointer = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');

/** Validators for one release, one compiled spec document per domain. */
export function bodyValidator(release: Release): (op: ApiOperation, contentType: string, body: string) => string[] {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  // Formats the specs use that ajv-formats doesn't define; the type is checked, the format isn't.
  for (const format of ['guid', 'int32', 'int64', 'double', 'float']) ajv.addFormat(format, true);
  const ids = new Map<Schema, string>();
  for (const op of loadOperations(release)) {
    if (ids.has(op.spec)) continue;
    const id = `spec-${release}-${op.domain}`;
    ajv.addSchema(withoutNullable(op.spec) as Schema, id);
    ids.set(op.spec, id);
  }
  const cache = new Map<string, ValidateFunction>();

  return (op, contentType, body) => {
    const declared = Object.keys(op.requestBodies);
    // Validate against the declared type that matches, or the operation's first declared type.
    const type = declared.includes(contentType) ? contentType : declared[0];
    let data: unknown;
    try {
      data = body === '' ? undefined : JSON.parse(body);
    } catch {
      return ['body is not JSON'];
    }
    if (type === JSON_PATCH) return jsonPatchProblems(data);
    const pointer = `${ids.get(op.spec)}#/paths/${escapePointer(op.path)}/${op.method.toLowerCase()}/requestBody/content/${escapePointer(type)}/schema`;
    let validate = cache.get(pointer);
    if (!validate) {
      validate = ajv.getSchema(pointer);
      if (!validate) throw new Error(`no request schema at ${pointer}`);
      cache.set(pointer, validate);
    }
    return validate(data) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '(body)'} ${e.message}`);
  };
}
