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
 *   value of the discriminator property, and a `oneOf` of mapped subtypes
 *   becomes a dispatch on that value (`if`/`then`). Without it, a `oneOf` of
 *   subtypes matches several and rejects valid data; with a plain `oneOf`,
 *   one bad value would also be reported for every branch it doesn't belong to.
 * - `allOf` with a closed member (`additionalProperties: false`, directly or
 *   through a `$ref` to a closed `allOf`): JSON Schema applies each member on
 *   its own, so an object with the properties of two members fails both. The
 *   members are opened and the `allOf` allows exactly the union of their
 *   properties. This fires on every such `allOf`, also on the many
 *   single-member wrappers `allOf: [{$ref: X}]` with a closed X, where it
 *   changes nothing.
 * - `nullable: true` → a `null` type, or `anyOf [..., null]` where it sits on
 *   `$ref`/`allOf`; an inline `enum` also gets `null`. The wrapper's own
 *   errors (`must be null`, `anyOf`) are dropped from findings; the errors of
 *   the non-null branch remain.
 * Formats: ajv-formats, plus `guid` and `time`. `time` is not an OpenAPI 3.0
 * format; the bMS sends .NET text such as `02:58` or `02:58:00.5`, so it
 * accepts `hh:mm`, optional seconds with up to 7 fraction digits, and an
 * optional offset (ajv-formats requires seconds and an offset). A leap second
 * is not accepted. A format the validator doesn't know fails the compile, so a
 * new format in a spec update can't go unchecked silently.
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
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,7})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/i;
/** Marks the schemas the nullable rewrite adds, so their errors can be dropped from findings. */
const NULLABLE = 'x-nullable-wrapper';

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
  const tags = new Map<string, { property: string; value: string }>();  // subtype name → its discriminator value
  for (const base of Object.values(schemas)) {
    const { propertyName, mapping } = base?.discriminator ?? {};
    if (typeof propertyName !== 'string' || !mapping) continue;
    for (const [value, ref] of Object.entries(mapping)) {
      const name = refName(ref) ?? '';
      const sub = schemas[name];
      if (!sub) throw new Error(`discriminator mapping ${value} → ${String(ref)}: no such schema`);
      sub.allOf = [...(sub.allOf ?? []), { properties: { [propertyName]: { const: value } } }];
      tags.set(name, { property: propertyName, value });
    }
  }
  /** Follows $ref (also alias chains such as `X: {$ref: Y}`) to the schema that defines something. */
  const resolve = (s: Schema): Schema | undefined => {
    const seen = new Set<Schema>();
    while (s?.$ref) {
      if (seen.has(s)) throw new Error(`cyclic $ref ${String(s.$ref)}`);
      seen.add(s);
      s = schemas[refName(s.$ref) ?? ''];
    }
    return s;
  };
  const isClosed = (member: Schema, seen = new Set<Schema>()): boolean => {
    const s = resolve(member);
    if (!s || seen.has(s)) return false;
    seen.add(s);
    return s.additionalProperties === false || (Array.isArray(s.allOf) && s.allOf.some((m: Schema) => isClosed(m, seen)));
  };
  const propertyNames = (s: Schema | undefined, seen: Set<Schema>): string[] => {
    if (!s || seen.has(s)) return [];
    seen.add(s);
    if (s.$ref) return propertyNames(resolve(s), seen);
    return [...Object.keys(s.properties ?? {}), ...(s.allOf ?? []).flatMap((m: Schema) => propertyNames(m, seen))];
  };
  const inlining = new Set<Schema>();
  /** A closed member, inlined and normalised, without its own closing. */
  const opened = (member: Schema): Schema => {
    const s = resolve(member)!;
    if (inlining.has(s)) throw new Error(`cyclic allOf through ${String(member.$ref)}`);
    inlining.add(s);
    const out = walk(s) as Schema;
    inlining.delete(s);
    delete out.additionalProperties;
    delete out.discriminator;
    return out;
  };
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const n = node as Schema;
    const out: Schema = {};
    for (const [k, v] of Object.entries(n)) out[k] = walk(v);
    if (Array.isArray(n.allOf) && n.allOf.some((m: Schema) => isClosed(m))) {
      const names = new Set([...Object.keys(n.properties ?? {}), ...n.allOf.flatMap((m: Schema) => propertyNames(m, new Set()))]);
      out.allOf = n.allOf.map((m: Schema) => (isClosed(m) ? opened(m) : walk(m)));
      out.properties = { ...Object.fromEntries([...names].map((name) => [name, true])), ...(out.properties ?? {}) };
      out.additionalProperties = false;
    }
    // A oneOf of subtypes of one discriminator: dispatch on its value, so only the chosen subtype reports errors.
    const branchTags = Array.isArray(n.oneOf) ? n.oneOf.map((b: Schema) => tags.get(refName(b?.$ref) ?? '')) : [];
    if (branchTags.length > 0 && branchTags.every(Boolean) && new Set(branchTags.map((x) => x!.property)).size === 1) {
      const property = branchTags[0]!.property;
      const { oneOf: _oneOf, ...rest } = out;
      return {
        ...rest,
        required: [...new Set([...(rest.required ?? []), property])],
        properties: { ...(rest.properties ?? {}), [property]: { enum: branchTags.map((x) => x!.value) } },
        allOf: [...(rest.allOf ?? []), ...n.oneOf.map((branch: Schema, i: number) => ({
          if: { required: [property], properties: { [property]: { const: branchTags[i]!.value } } },
          then: branch,
        }))],
      };
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
  return { anyOf: [out, { type: 'null', [NULLABLE]: true }], [NULLABLE]: true };
}

/** A whole OpenAPI 3.0 document as a JSON Schema document ajv validates as the API means it. The input is not changed. */
export function toJsonSchema(spec: Schema): Schema {
  return withoutNullable(withPolymorphism(structuredClone(spec))) as Schema;
}

function newAjv(): AjvInstance {
  // strict: false accepts the OpenAPI-only keywords (discriminator, example, readOnly …); ajv then only
  // warns about an unknown format, so the logger turns that warning into a compile error.
  const failOnUnknownFormat = (...args: unknown[]): void => {
    const text = args.map(String).join(' ');
    if (/unknown format/.test(text)) throw new Error(text);
  };
  const ajv = new Ajv({ strict: false, allErrors: true, verbose: true, logger: { log() {}, warn: failOnUnknownFormat, error: failOnUnknownFormat } });
  addFormats(ajv);
  ajv.addFormat('guid', GUID);
  ajv.addFormat('time', TIME);
  return ajv;
}

function findingsOf(errors: ErrorObject[] | null | undefined): SchemaFinding[] {
  const seen = new Map<string, SchemaFinding>();
  for (const e of errors ?? []) {
    // The nullable wrapper's own errors and the dispatch's "must match then" repeat what the branch reports.
    if (e.parentSchema?.[NULLABLE] === true || e.keyword === 'if') continue;
    // ajv names a missing required property in the message already, an additional one only in params.
    const extra = e.keyword === 'additionalProperties' ? ` '${String(e.params.additionalProperty)}'` : '';
    const finding = {
      // Folds array indices; a numeric object key (e.g. a map keyed "2024") is folded too.
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
