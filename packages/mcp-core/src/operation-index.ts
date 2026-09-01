/**
 * A runtime index of the OpenAPI operations a bConnect module declares.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `src/generated/*-types.ts` is `openapi-typescript` output: it is *types only*
 * and erases completely at runtime. So `operations["GetWindowsEndpoint"]` can be
 * type-checked against but cannot be read, and a declaration layer that derives
 * a tool's schema from its spec operation needs to read it.
 *
 * This module distils an OpenAPI 3.x document down to the facts a tool schema
 * and a validation rule are built from — route, verb, parameter names, JSON
 * types, `required` sets, enum values, request-body fields — and drops
 * everything else (responses, examples, the `x-` extensions, the prose).
 * Measured on 26R1: the twelve specs total 1.09 MB; their indexes total ~74 KB.
 *
 * ── Where the input comes from ──────────────────────────────────────────────
 * Either directly (`buildOperationIndex(require("...json"), "compliance")`), or
 * from a compact index emitted at build time. The compact form is the one to
 * ship — see `serializeOperationIndex`. Nothing here reads the filesystem, so
 * the choice belongs to the caller.
 *
 * ── The one judgement encoded here ──────────────────────────────────────────
 * OpenAPI `integer` becomes JSON-Schema `number`. The suite's hand-written tool
 * schemas have always said `"number"` for `Page` and `PageSize`, and MCP clients
 * emit JSON numbers; introducing `"integer"` now would change 140-odd advertised
 * schemas for no behavioural gain. `format: "int32"` is preserved so a caller
 * that wants the distinction still has it.
 */

// ── The distilled shapes ─────────────────────────────────────────────────────

/** JSON-Schema types a bConnect parameter can have. */
export type JsonType = "string" | "number" | "boolean" | "array" | "object";

export interface OperationParameter {
  name: string;
  /**
   * The vendor's own prose, verbatim and untidied.
   *
   * Kept because the declaration layer has to *judge* it — short field prose is
   * worth advertising, the 105-byte page sentence is not — and a judgement
   * cannot be made about a string that was thrown away. Nothing copies it
   * blindly; see `DERIVED_DESCRIPTION_LIMIT`.
   */
  description?: string;
  /** `path` parameters are always required; `query` usually is not. */
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  type: JsonType;
  /** e.g. `"guid"`, `"int32"`, `"date-time"` — drives validation `format`. */
  format?: string;
  /** Present when the spec constrains the value. */
  enum?: string[];
  /** For `type: "array"`, the item type. */
  items?: { type: JsonType };
}

export interface OperationBodyField {
  name: string;
  /**
   * As `OperationParameter.description`. Body-field prose is usually short and
   * genuinely useful — `"The name of the folder"` — unlike the query-parameter
   * prose the token findings measured.
   */
  description?: string;
  required: boolean;
  type: JsonType;
  format?: string;
  enum?: string[];
  items?: { type: JsonType };
}

export interface OperationBody {
  /** e.g. `application/json`, `application/json-patch+json`. */
  contentType: string;
  required: boolean;
  /**
   * The body's own fields, flattened through `allOf`. Empty for a body whose
   * schema is not an object — a JSON Patch document, for instance, is an array;
   * `isArray` says so and the declaration layer must hand-author those.
   */
  fields: OperationBodyField[];
  isArray: boolean;
}

export interface SpecOperation {
  operationId: string;
  method: "get" | "put" | "post" | "delete" | "patch" | "head" | "options";
  path: string;
  summary?: string;
  parameters: OperationParameter[];
  body?: OperationBody;
}

export interface OperationIndex {
  /** The bConnect module, e.g. `"compliance"`. Used only in error messages. */
  module: string;
  operations: Record<string, SpecOperation>;
}

// ── Minimal structural view of an OpenAPI document ───────────────────────────
// Deliberately loose: these specs are vendor output and this module's job is to
// survive their shape, not to validate it.

type Json = Record<string, unknown>;

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `#/components/schemas/Folder` → the schema object, or `undefined`. */
function resolveRef(doc: Json, ref: string): Json | undefined {
  if (!ref.startsWith("#/")) {
    return undefined;
  }
  let node: unknown = doc;
  for (const segment of ref.slice(2).split("/")) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObject(node)) {
      return undefined;
    }
    node = node[key];
  }
  return isObject(node) ? node : undefined;
}

/**
 * Follow `$ref` and flatten `allOf` into one schema object.
 *
 * bConnect wraps almost every request body as `allOf: [{ $ref: ... }]` — a
 * single-element allOf around a ref — so a resolver that does not flatten allOf
 * finds no properties at all and silently derives an empty body.
 *
 * `seen` breaks the self-referential schemas (a folder whose parent is a
 * folder); a cycle yields what was resolved before the repeat, not a hang.
 */
function flattenSchema(doc: Json, schema: unknown, seen: Set<string> = new Set()): Json {
  if (!isObject(schema)) {
    return {};
  }

  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) {
      return {};
    }
    seen.add(schema.$ref);
    return flattenSchema(doc, resolveRef(doc, schema.$ref), seen);
  }

  if (Array.isArray(schema.allOf)) {
    const merged: Json = { type: "object", properties: {}, required: [] as string[] };
    for (const part of schema.allOf) {
      const flat = flattenSchema(doc, part, seen);
      if (typeof flat.type === "string" && flat.type !== "object") {
        merged.type = flat.type;
      }
      Object.assign(merged.properties as Json, (flat.properties as Json) ?? {});
      if (Array.isArray(flat.required)) {
        (merged.required as string[]).push(...(flat.required as string[]));
      }
      if (flat.items !== undefined && merged.items === undefined) {
        merged.items = flat.items;
      }
      if (Array.isArray(flat.enum) && merged.enum === undefined) {
        merged.enum = flat.enum;
      }
    }
    // Anything the sibling keys of allOf declare wins over the merged parts.
    const { allOf: _allOf, ...siblings } = schema;
    return { ...merged, ...siblings };
  }

  return schema;
}

/** OpenAPI type → JSON-Schema type, with the `integer → number` decision. */
function jsonTypeOf(schema: Json | undefined): JsonType {
  const raw = schema?.type;
  if (raw === "integer" || raw === "number") {
    return "number";
  }
  if (raw === "boolean" || raw === "array" || raw === "object" || raw === "string") {
    return raw;
  }
  // A schema with only `$ref`/`allOf` already flattened away, or an untyped
  // free-form value. `string` is the safe advertisement: it round-trips.
  return "string";
}

function enumOf(schema: Json | undefined): string[] | undefined {
  const values = schema?.enum;
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }
  return values.filter((v): v is string => typeof v === "string");
}

function itemsOf(doc: Json, schema: Json | undefined): { type: JsonType } | undefined {
  if (jsonTypeOf(schema) !== "array") {
    return undefined;
  }
  return { type: jsonTypeOf(flattenSchema(doc, schema?.items)) };
}

function formatOf(schema: Json | undefined): string | undefined {
  return typeof schema?.format === "string" ? schema.format : undefined;
}

function parameterFrom(doc: Json, raw: unknown): OperationParameter | null {
  const param = flattenSchema(doc, raw);
  if (typeof param.name !== "string") {
    return null;
  }
  const where = param.in;
  if (where !== "path" && where !== "query" && where !== "header" && where !== "cookie") {
    return null;
  }
  const schema = flattenSchema(doc, param.schema);
  // OpenAPI allows the prose on either the parameter or its schema; 26R1 uses
  // the parameter, but a `$ref`'d parameter carries it on the schema.
  const description =
    typeof param.description === "string"
      ? param.description
      : typeof schema.description === "string"
        ? schema.description
        : undefined;

  return {
    name: param.name,
    in: where,
    ...(description !== undefined ? { description } : {}),
    // A path parameter is required whether or not the vendor said so — the
    // route does not exist without it. Two 26R1 operations omit the flag.
    required: where === "path" ? true : param.required === true,
    type: jsonTypeOf(schema),
    ...(formatOf(schema) ? { format: formatOf(schema) } : {}),
    ...(enumOf(schema) ? { enum: enumOf(schema) } : {}),
    ...(itemsOf(doc, schema) ? { items: itemsOf(doc, schema) } : {}),
  };
}

function bodyFrom(doc: Json, raw: unknown): OperationBody | undefined {
  const requestBody = flattenSchema(doc, raw);
  const content = requestBody.content;
  if (!isObject(content)) {
    return undefined;
  }
  const contentType = Object.keys(content)[0];
  if (contentType === undefined) {
    return undefined;
  }
  const media = content[contentType];
  const schema = flattenSchema(doc, isObject(media) ? media.schema : undefined);
  const isArray = jsonTypeOf(schema) === "array";
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as unknown[]).filter((r) => typeof r === "string") : []
  );
  const properties = isObject(schema.properties) ? schema.properties : {};

  const fields: OperationBodyField[] = Object.entries(properties).map(([name, rawField]) => {
    const field = flattenSchema(doc, rawField);
    return {
      name,
      ...(typeof field.description === "string" ? { description: field.description } : {}),
      required: required.has(name),
      type: jsonTypeOf(field),
      ...(formatOf(field) ? { format: formatOf(field) } : {}),
      ...(enumOf(field) ? { enum: enumOf(field) } : {}),
      ...(itemsOf(doc, field) ? { items: itemsOf(doc, field) } : {}),
    };
  });

  return {
    contentType,
    required: requestBody.required === true,
    fields,
    isArray,
  };
}

/**
 * Distil an OpenAPI 3.x document into an `OperationIndex`.
 *
 * @param document  the parsed spec, e.g. `bConnect_Compliance.json`
 * @param module    the bConnect module name, for error messages
 * @throws {Error} if two operations share an `operationId` — the index is keyed
 *                 on it, so a collision would silently shadow one route.
 */
export function buildOperationIndex(document: unknown, module: string): OperationIndex {
  if (!isObject(document) || !isObject(document.paths)) {
    throw new Error(`buildOperationIndex(${module}): document has no \`paths\` object.`);
  }

  const operations: Record<string, SpecOperation> = {};
  const collisions: string[] = [];

  for (const [path, rawItem] of Object.entries(document.paths)) {
    if (!isObject(rawItem)) {
      continue;
    }
    // Parameters declared on the path item apply to every operation under it.
    const shared = Array.isArray(rawItem.parameters) ? rawItem.parameters : [];

    for (const method of HTTP_METHODS) {
      const op = rawItem[method];
      if (!isObject(op) || typeof op.operationId !== "string") {
        continue;
      }
      const own = Array.isArray(op.parameters) ? op.parameters : [];

      const byName = new Map<string, OperationParameter>();
      for (const raw of [...shared, ...own]) {
        const parsed = parameterFrom(document, raw);
        if (parsed) {
          // Operation-level wins over path-level, which is what OpenAPI says.
          byName.set(parsed.name, parsed);
        }
      }

      if (operations[op.operationId] !== undefined) {
        collisions.push(op.operationId);
      }

      operations[op.operationId] = {
        operationId: op.operationId,
        method,
        path,
        ...(typeof op.summary === "string" ? { summary: op.summary } : {}),
        parameters: [...byName.values()],
        ...(op.requestBody !== undefined
          ? { body: bodyFrom(document, op.requestBody) }
          : {}),
      };
    }
  }

  if (collisions.length > 0) {
    throw new Error(
      `buildOperationIndex(${module}): duplicate operationId(s): ${[...new Set(collisions)].join(", ")}. ` +
        "The index is keyed on operationId, so one route would silently shadow the other."
    );
  }

  return { module, operations };
}

/**
 * Look an operation up, failing with a message that names the module.
 *
 * @throws {Error} if `operationId` is not in the index. This is the check that
 *                 catches a tool declared against an operation the vendor
 *                 removed — 26R1 deleting `IndustrialEndpoints` is the live
 *                 example — at construction rather than at first call.
 */
export function requireOperation(index: OperationIndex, operationId: string): SpecOperation {
  const operation = index.operations[operationId];
  if (operation === undefined) {
    throw new Error(
      `${index.module}: no operation "${operationId}" in the spec. ` +
        "Either the operationId is misspelt or the vendor removed the route."
    );
  }
  return operation;
}

/** The index as JSON, for a build step that ships it instead of the full spec. */
export function serializeOperationIndex(index: OperationIndex): string {
  return JSON.stringify(index);
}

/** The inverse of `serializeOperationIndex`. */
export function deserializeOperationIndex(json: string): OperationIndex {
  return JSON.parse(json) as OperationIndex;
}
