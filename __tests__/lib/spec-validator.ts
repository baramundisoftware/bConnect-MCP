/**
 * The one spec validator of the test harness (REQ-QA-005): validates JSON
 * against the bundled OpenAPI 3.0 specs, for request bodies (spec-conformance
 * guard) and 2xx answers (live tier). It is the only module that loads ajv
 * (one-ajv.guard.test.ts).
 *
 * The specs are OpenAPI 3.0 and use patterns that JSON Schema reads
 * differently. `toJsonSchema` rewrites them, so valid data isn't reported as
 * a spec difference:
 * - `discriminator` on a base type: each mapped subtype accepts only its own
 *   value of the discriminator property. Without it, a `oneOf` of subtypes
 *   matches several and rejects valid data.
 * - `allOf` with a member that has `additionalProperties: false` (in the specs
 *   the base type itself, and the subtype's own part): JSON Schema applies
 *   each member on its own, so no object can satisfy all of them. The members
 *   lose `additionalProperties: false` and the `allOf` allows exactly the
 *   union of their properties.
 * - `nullable: true` → a `null` type, or `anyOf [..., null]` where it sits on
 *   `$ref`/`allOf`; an inline `enum` also gets `null`.
 * Formats: `guid`; `int32`/`int64`/`float`/`double` are annotations (the type
 * is checked); `time` accepts .NET TimeSpan text (`02:00:00`, up to 7
 * fraction digits) with an optional offset, where ajv-formats requires one.
 */
import { createRequire } from 'node:module';
import type { Ajv as AjvInstance, ErrorObject, ValidateFunction } from 'ajv';
import { type ApiOperation, type Release, type Schema, loadOperations } from './spec.js';

// ajv and ajv-formats are CommonJS; under Node16 module resolution their default
// exports don't type-check as ESM default imports, so they are loaded with require.
const require = createRequire(import.meta.url);
const { Ajv } = require('ajv') as { Ajv: typeof AjvInstance };
const addFormats = require('ajv-formats') as (ajv: AjvInstance) => AjvInstance;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,7})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/i;

/** One way a value differs from its schema; array indices are folded so repeats collapse. */
export interface SchemaFinding {
  path: string;     // e.g. /[]/lastSeen, or / for the value itself
  keyword: string;  // e.g. format, required, additionalProperties
  message: string;  // e.g. must match format "date-time"
}

const SCHEMA_REF = '#/components/schemas/';
const refName = (ref: unknown): string | undefined =>
  typeof ref === 'string' && ref.startsWith(SCHEMA_REF) ? ref.slice(SCHEMA_REF.length) : undefined;

/** discriminator + closed allOf, on a copy of the spec's schemas. */
function withPolymorphism(spec: Schema): Schema {
  const schemas: Record<string, Schema> = spec.components?.schemas ?? {};
  for (const base of Object.values(schemas)) {
    const { propertyName, mapping } = base?.discriminator ?? {};
    if (typeof propertyName !== 'string' || !mapping) continue;
    for (const [value, ref] of Object.entries(mapping)) {
      const sub = schemas[refName(ref) ?? ''];
      if (!sub) throw new Error(`discriminator mapping ${value} → ${String(ref)}: no such schema`);
      sub.allOf = [...(sub.allOf ?? []), { properties: { [propertyName]: { const: value } } }];
    }
  }
  const resolve = (s: Schema): Schema | undefined => (s?.$ref ? schemas[refName(s.$ref) ?? ''] : s);
  const isClosed = (member: Schema): boolean => resolve(member)?.additionalProperties === false;
  const propertyNames = (s: Schema | undefined, seen: Set<Schema>): string[] => {
    if (!s || seen.has(s)) return [];
    seen.add(s);
    if (s.$ref) return propertyNames(resolve(s), seen);
    return [...Object.keys(s.properties ?? {}), ...(s.allOf ?? []).flatMap((m: Schema) => propertyNames(m, seen))];
  };
  const opened = (member: Schema): Schema => {
    const { additionalProperties: _closed, discriminator: _d, ...rest } = resolve(member)!;
    return rest;
  };
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const n = node as Schema;
    const out: Schema = {};
    for (const [k, v] of Object.entries(n)) out[k] = walk(v);
    if (Array.isArray(n.allOf) && n.allOf.some(isClosed)) {
      const names = new Set([...Object.keys(n.properties ?? {}), ...n.allOf.flatMap((m: Schema) => propertyNames(m, new Set()))]);
      out.allOf = n.allOf.map((m: Schema) => walk(isClosed(m) ? opened(m) : m));
      out.properties = { ...Object.fromEntries([...names].map((name) => [name, true])), ...(out.properties ?? {}) };
      out.additionalProperties = false;
    }
    return out;
  };
  return walk(spec) as Schema;
}

/** OpenAPI 3.0 `nullable` → JSON Schema. */
function withoutNullable(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutNullable);
  if (!node || typeof node !== 'object') return node;
  const out: Schema = {};
  for (const [k, v] of Object.entries(node)) out[k] = withoutNullable(v);
  const nullable = out.nullable === true;
  delete out.nullable;
  if (!nullable) return out;
  if (typeof out.type === 'string' && !out.$ref) {
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
    return { ...out, type: [out.type, 'null'] };
  }
  return { anyOf: [out, { type: 'null' }] };
}

/** A whole OpenAPI 3.0 document as a JSON Schema document ajv validates as the API means it. The input is not changed. */
export function toJsonSchema(spec: Schema): Schema {
  return withoutNullable(withPolymorphism(structuredClone(spec))) as Schema;
}

function newAjv(): AjvInstance {
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
  addFormats(ajv);
  ajv.addFormat('guid', GUID);
  ajv.addFormat('time', TIME);
  for (const format of ['int32', 'int64', 'double', 'float']) ajv.addFormat(format, true);
  return ajv;
}

function findingsOf(errors: ErrorObject[] | null | undefined): SchemaFinding[] {
  const seen = new Map<string, SchemaFinding>();
  for (const e of errors ?? []) {
    // ajv names a missing required property in the message already, an additional one only in params.
    const extra = e.keyword === 'additionalProperties' ? ` '${String(e.params.additionalProperty)}'` : '';
    const finding = {
      path: e.instancePath.replace(/\/\d+(?=\/|$)/g, '/[]') || '/',
      keyword: e.keyword,
      message: `${e.message ?? e.keyword}${extra}`,
    };
    seen.set(`${finding.path}\n${finding.keyword}\n${finding.message}`, finding);
  }
  return [...seen.values()];
}

const escapePointer = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');

/** Differences between `data` and a named schema of an OpenAPI document (fixture tests). */
export function checkSchema(spec: Schema, name: string, data: unknown): SchemaFinding[] {
  if (!spec.components?.schemas?.[name]) throw new Error(`no schema ${name} in the document`);
  const ajv = newAjv();
  ajv.addSchema(toJsonSchema(spec), 'fixture');
  const validate = ajv.getSchema(`fixture#/components/schemas/${escapePointer(name)}`)!;
  return validate(data) ? [] : findingsOf(validate.errors);
}

export interface SpecValidator {
  /**
   * Problems with a parsed JSON request body for one declared content type; empty when valid.
   * `ignoreFormats` drops `format` errors (for bodies built from the guard's sample values).
   */
  body(op: ApiOperation, contentType: string, data: unknown, options?: { ignoreFormats?: boolean }): string[];
  /** Differences between a 2xx answer and the operation's 2xx JSON schema; throws when it declares none. */
  response(op: ApiOperation, data: unknown): SchemaFinding[];
}

const validators = new Map<Release, SpecValidator>();

/** The validator for one release: one ajv, one compiled spec document per domain. */
export function specValidator(release: Release): SpecValidator {
  const cached = validators.get(release);
  if (cached) return cached;
  const ajv = newAjv();
  const ids = new Map<Schema, string>();
  for (const op of loadOperations(release)) {
    if (ids.has(op.spec)) continue;
    const id = `spec-${release}-${op.domain}`;
    ajv.addSchema(toJsonSchema(op.spec), id);
    ids.set(op.spec, id);
  }
  const compiled = new Map<string, ValidateFunction>();
  const compile = (op: ApiOperation, pointer: string): ValidateFunction => {
    const key = `${ids.get(op.spec)}#/paths/${escapePointer(op.path)}/${op.method.toLowerCase()}/${pointer}`;
    let validate = compiled.get(key);
    if (!validate) {
      validate = ajv.getSchema(key);
      if (!validate) throw new Error(`no schema at ${key}`);
      compiled.set(key, validate);
    }
    return validate;
  };

  const validator: SpecValidator = {
    body(op, contentType, data, options = {}) {
      const validate = compile(op, `requestBody/content/${escapePointer(contentType)}/schema`);
      if (validate(data)) return [];
      return (validate.errors ?? [])
        .filter((e) => !(options.ignoreFormats && e.keyword === 'format'))
        .map((e) => `${e.instancePath || '(body)'} ${e.message}`);
    },
    response(op, data) {
      if (!op.okStatus) throw new Error(`no 2xx JSON response schema for ${op.operationId} (${op.method} ${op.path})`);
      const validate = compile(op, `responses/${op.okStatus}/content/application~1json/schema`);
      return validate(data) ? [] : findingsOf(validate.errors);
    },
  };
  validators.set(release, validator);
  return validator;
}
