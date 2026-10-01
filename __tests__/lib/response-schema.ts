/**
 * Validates a bConnect response body against the 2xx response schema its
 * operation declares in the bundled OpenAPI spec. Used by the live tier to
 * report where a real bMS answers differently from its spec.
 *
 * The specs are OpenAPI 3.0: `nullable: true` is turned into a JSON Schema null
 * type before Ajv sees them, and the OpenAPI-only formats (int32, double, …) are
 * accepted as annotations.
 */
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import * as formatsModule from 'ajv-formats';
import type { ApiOperation, Schema } from './spec.js';

type AddFormats = (ajv: Ajv) => Ajv;
const mod = formatsModule as unknown as { default: AddFormats | { default: AddFormats } };
const addFormats: AddFormats = typeof mod.default === 'function' ? mod.default : mod.default.default;

const ANNOTATION_FORMATS = ['int32', 'int64', 'float', 'double', 'password', 'binary'];

/** OpenAPI 3.0 schema → JSON Schema (draft-07) for Ajv. */
export function toJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const { nullable, ...rest } = schema as Schema;
  const out: Schema = {};
  for (const [key, value] of Object.entries(rest)) out[key] = toJsonSchema(value);
  if (nullable !== true) return out;
  if (typeof out.type === 'string' && !out.$ref) {
    out.type = [out.type, 'null'];
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
    return out;
  }
  return { anyOf: [out, { type: 'null' }] };
}

/** One way a response differs from its schema, with array indices folded so repeats collapse. */
export interface SchemaFinding {
  path: string;      // e.g. /[]/lastSeen
  keyword: string;   // e.g. format, required, additionalProperties
  message: string;   // e.g. must match format "date-time"
}

function findingOf(e: ErrorObject): SchemaFinding {
  const extra = e.keyword === 'additionalProperties' ? ` '${String(e.params.additionalProperty)}'`
    : e.keyword === 'required' ? ` '${String(e.params.missingProperty)}'` : '';
  return {
    path: e.instancePath.replace(/\/\d+(?=\/|$)/g, '/[]') || '/',
    keyword: e.keyword,
    message: `${e.message ?? e.keyword}${extra}`,
  };
}

export function createResponseValidator() {
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
  addFormats(ajv);
  for (const f of ANNOTATION_FORMATS) ajv.addFormat(f, true);
  const docs = new Set<string>();
  const compiled = new Map<string, ValidateFunction | null>();

  const key = (op: ApiOperation): string => `${op.release}:${op.domain}:${op.method}:${op.path}`;

  /** One Ajv document per spec: its components plus every operation's 2xx schema, so internal $refs resolve. */
  function docFor(op: ApiOperation): string {
    const id = `bconnect-${op.release}-${op.domain}`;
    if (docs.has(id)) return id;
    const ok: Schema = {};
    for (const [path, byMethod] of Object.entries<Schema>(op.spec.paths ?? {})) {
      for (const [method, operation] of Object.entries<Schema>(byMethod)) {
        for (const [code, response] of Object.entries<Schema>(operation?.responses ?? {})) {
          const schema = /^2/.test(code) ? response.content?.['application/json']?.schema : undefined;
          if (schema && !ok[`${method.toUpperCase()} ${path}`]) ok[`${method.toUpperCase()} ${path}`] = schema;
        }
      }
    }
    ajv.addSchema(toJsonSchema({ $id: id, components: op.spec.components ?? {}, ok }) as Schema);
    docs.add(id);
    return id;
  }

  return {
    /** Differences between `body` and the operation's 2xx schema; empty when it conforms or declares none. */
    check(op: ApiOperation, body: unknown): SchemaFinding[] {
      if (!op.okSchema) return [];
      let validate = compiled.get(key(op));
      if (validate === undefined) {
        const pointer = `${op.method} ${op.path}`.replace(/~/g, '~0').replace(/\//g, '~1');
        validate = ajv.getSchema(`${docFor(op)}#/ok/${encodeURIComponent(pointer)}`) ?? null;
        compiled.set(key(op), validate);
      }
      if (!validate || validate(body)) return [];
      const seen = new Map<string, SchemaFinding>();
      for (const e of validate.errors ?? []) {
        const f = findingOf(e);
        seen.set(`${f.path} ${f.keyword} ${f.message}`, f);
      }
      return [...seen.values()];
    },
  };
}
