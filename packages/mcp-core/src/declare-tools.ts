/**
 * The declaration layer — declare a tool once, get its schema and its
 * validation from the same source.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * A bConnect tool is currently written out four times:
 *
 *   1. the `tools/list` entry            index.ts — name, description, inputSchema
 *   2. the `CallTool` case arm           index.ts — args → module method
 *   3. the module method                 src/modules/*.ts — verb + route
 *   4. the validation rule               src/utils/mcp-tool-validation-rules.ts
 *
 * Layers 1, 2 and 4 restate one OpenAPI operation. `get_windows_endpoint` types
 * `WindowsEndpoints` four times and `id` four times. Across thirteen servers
 * layer 4 alone is 2,079 lines, and its own header already admits what happened:
 * *"the pre-existing rules had drifted away from the schemas"*.
 *
 * Measured over the suite (`scratchpad/derivable.mjs`): 58 of 67 endpoints tools
 * (87%), 31 of 37 jobs tools (84%) and 6 of 10 compliance tools are 1:1 wrappers
 * around a single spec operation. For those, everything except the description
 * is mechanical.
 *
 * ── This is an invariant the suite already tests, run backwards ─────────────
 * `__tests__/suite-schema-vs-types.test.ts` (17 tests, passing) already asserts
 * the relation in the *checking* direction: a tool schema must not advertise
 * what its operation does not declare, enums must carry their values, required
 * body fields must be exposed and required, routes and verbs must exist. This
 * module runs that same relation in the generating direction. It introduces no
 * new invariant — it stops hand-writing the side the test already derives.
 *
 * ── What it will NOT generate, on purpose ──────────────────────────────────
 * **Descriptions.** Spec summaries are useless as tool descriptions —
 * `CreateFolder` says "Creates a folder according to the specified properties",
 * while the shipped tool says which library it writes to, that folders organise
 * job definitions, and WARNs that it creates something. Descriptions are 28.1%
 * of the default catalogue (35,087 B of 124,865 B) and none of it is derivable.
 * Every declaration therefore states its description in full, verbatim.
 *
 * **Long parameter prose.** A parameter whose spec description exceeds
 * `DERIVED_DESCRIPTION_LIMIT` is refused, not copied: those are exactly the
 * strings `schema-fragments.ts` exists to replace (the 105-char page sentence,
 * the 166-char LastAction sentence). Give it a canonical fragment or a
 * `describe` entry. The failure is at construction, in a test, not in a
 * catalogue an operator pays for on every session.
 *
 * **Composite tools.** `get_fleet_summary`, `diagnose_job`,
 * `get_vulnerability_exposure` and the rest are backed by ~3,400 lines of
 * dedicated modules and answer no single route. They pass through `composite()`
 * untouched — same object, same order, same bytes.
 *
 * ── D6: exposing a parameter the route does not have is a correctness bug ───
 * bConnect answers **HTTP 200 and silently drops** a query parameter it does not
 * know. A tool that advertises `OrderBy` on a route without it returns an
 * unsorted list that looks sorted. So: `expose` is checked against the operation
 * and an unknown name throws, and omitting `expose` advertises exactly what the
 * operation declares — never more.
 *
 * ── Composes with `defineToolCatalogue`, does not replace it ────────────────
 * `defineTools()` returns `{ tools, write }` in declaration order, which is
 * precisely the `{ tools, write }` spec `defineToolCatalogue` already takes. The
 * write gate, the duplicate-name check and the declared-order guarantee are
 * unchanged and still theirs.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 * ```ts
 * const index = buildOperationIndex(complianceSpec, "compliance");
 *
 * export const DECLARED = defineTools(index, {
 *   list_vulnerabilities: {
 *     op: "GetAllVulnerabilities",
 *     description: "List known vulnerabilities. Compact projection by default.",
 *     shaping: ["countOnly"],
 *   },
 *   get_vulnerability: {
 *     op: "GetVulnerability",
 *     description: "Get one vulnerability by id.",
 *   },
 *   get_vulnerability_exposure: composite({
 *     description: "Which endpoints are exposed to a CVE, and how badly ...",
 *     inputSchema: objectSchema({ cveId: { type: "string", ... } }, ["cveId"]),
 *   }),
 * });
 *
 * const catalogue = defineToolCatalogue(DECLARED);   // { tools, write }
 * // ... and in the CallTool handler:
 * DECLARED.validate(name, args);
 * ```
 */

import type { ValidationRule } from "./parameter-validator.js";
import { CommonRules, validateOrThrow } from "./parameter-validator.js";
import type { SchemaProperties, SchemaProperty } from "./schema-fragments.js";
import {
  PAGE_DESCRIPTION,
  PAGE_SIZE_DESCRIPTION,
  SEARCH_QUERY_DESCRIPTION,
  ORDER_BY_DESCRIPTION,
  detailProperty,
  fieldsProperty,
  countOnlyProperty,
  includeSubfoldersProperty,
} from "./schema-fragments.js";
import type { OperationIndex, OperationParameter, SpecOperation } from "./operation-index.js";
import { requireOperation } from "./operation-index.js";

/**
 * Longest spec description this layer will copy into an advertised schema.
 *
 * 80 bytes. Above it the vendor's prose is the boilerplate the token findings
 * measured, not documentation — the page sentence is 105 B, the LastAction
 * sentence 166 B — and the author is made to choose a wording instead.
 */
export const DERIVED_DESCRIPTION_LIMIT = 80;

// ── The response-shaping vocabulary ──────────────────────────────────────────
//
// Local inventions of `shape-response.ts` and `count-only.ts`; the API has no
// such concepts. Named here so a declaration spells them the same way in all
// thirteen servers.

export type ShapingName = "detail" | "fields" | "countOnly" | "includeSubfolders";

const SHAPING_FRAGMENTS: Record<ShapingName, SchemaProperties> = {
  detail: detailProperty,
  fields: fieldsProperty,
  countOnly: countOnlyProperty,
  includeSubfolders: includeSubfoldersProperty,
};

const SHAPING_RULES: Record<ShapingName, ValidationRule> = {
  detail: { name: "detail", required: false, type: "boolean", message: "detail must be a boolean" },
  fields: { name: "fields", required: false, type: "array", message: "fields must be an array of property names" },
  countOnly: { name: "countOnly", required: false, type: "boolean", message: "countOnly must be a boolean" },
  includeSubfolders: {
    name: "includeSubfolders",
    required: false,
    type: "boolean",
    message: "includeSubfolders must be a boolean",
  },
};

// ── Canonical wordings for the parameters every module repeats ───────────────

const CANONICAL_DESCRIPTIONS: Record<string, string> = {
  Page: PAGE_DESCRIPTION,
  PageSize: PAGE_SIZE_DESCRIPTION,
  SearchQuery: SEARCH_QUERY_DESCRIPTION,
  OrderBy: ORDER_BY_DESCRIPTION,
};

const CANONICAL_RULES: Record<string, () => ValidationRule> = {
  Page: CommonRules.page,
  PageSize: CommonRules.pageSize,
  SearchQuery: CommonRules.searchQuery,
  OrderBy: CommonRules.orderBy,
};

/** The vendor sentence every exact-match filter was copied from. */
const EXACT_MATCH_SENTENCE = /^Filters? results? by matching the exact value against /i;

// ── Declarations ─────────────────────────────────────────────────────────────

export interface ToolDeclaration {
  /** `operationId` in the module's spec. Resolves to route, verb and params. */
  op: string;

  /**
   * The tool description, in full. Never derived — see the header. Written
   * verbatim into the catalogue, so an existing tool keeps its exact bytes.
   */
  description: string;

  /**
   * The parameters to advertise, a D6-safe subset of what the operation
   * declares. Omit to advertise all of them. A name the operation does not
   * declare throws.
   */
  expose?: readonly string[];

  /** Parameters to drop. Mutually exclusive with `expose`. */
  omit?: readonly string[];

  /** Per-parameter wording, for anything not canonical and not short. */
  describe?: Record<string, string>;

  /** Local response-shaping parameters to spread in, in this order. */
  shaping?: readonly ShapingName[];

  /** Body fields to advertise. Omit to advertise all of them. */
  body?: readonly string[];

  /** Extra hand-authored properties the spec cannot know about. */
  extra?: SchemaProperties;

  /** Names within `extra` that are required. */
  extraRequired?: readonly string[];

  /** Does this tool mutate? Feeds `defineToolCatalogue`'s write gate. */
  write?: boolean;
}

/** A hand-authored tool that answers no single route. Passed through as-is. */
export interface CompositeDeclaration {
  readonly kind: "composite";
  description: string;
  inputSchema: { type: "object"; properties: SchemaProperties; required?: string[] };
  write?: boolean;
  /** Validation rules, hand-authored: there is no operation to derive from. */
  rules?: readonly ValidationRule[];
}

/**
 * The escape hatch for the differentiated tools.
 *
 * `get_fleet_summary`, `get_stale_endpoints`, `diagnose_job`,
 * `explain_job_failure`, `preview_assignment`, `get_vulnerability_exposure`,
 * `get_unpatched_endpoints` and the rest are the reason this suite is worth
 * more than a REST proxy. Nothing here rewrites them: the object you pass is
 * the object advertised.
 */
export function composite(
  spec: Omit<CompositeDeclaration, "kind">
): CompositeDeclaration {
  return { kind: "composite", ...spec };
}

function isComposite(value: ToolDeclaration | CompositeDeclaration): value is CompositeDeclaration {
  return (value as CompositeDeclaration).kind === "composite";
}

/** A derived `tools/list` entry. Structurally what the SDK expects. */
export interface DerivedTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: SchemaProperties; required?: string[] };
}

export interface DeclaredTools {
  /** In declaration order — `defineToolCatalogue`'s order guarantee holds. */
  readonly tools: DerivedTool[];
  /** Write tool names, for `defineToolCatalogue({ tools, write })`. */
  readonly write: string[];
  /** Derived validation rules, keyed on tool name. */
  readonly rules: ReadonlyMap<string, ValidationRule[]>;
  /** Rules for one tool; empty array for an unknown name. */
  rulesFor(toolName: string): ValidationRule[];
  /** Validate arguments, throwing `-32602` on failure. One call per dispatch. */
  validate(toolName: string, args: Record<string, unknown> | undefined): void;
  /** `{ method, path }` for a wrapper tool; `undefined` for a composite. */
  routeFor(toolName: string): { method: string; path: string } | undefined;
}

// ── Derivation ───────────────────────────────────────────────────────────────

/** `logicalGroupId` → `logical group`; `id` → the operation's resource. */
function humaniseIdParameter(name: string, operation: SpecOperation): string {
  const stem = name.replace(/Id$/i, "");
  if (stem === "" || stem.toLowerCase() === "the") {
    // A bare `id`: name the resource the route addresses, e.g.
    // /v2.0/WindowsEndpoints/{id} → "windows endpoint".
    const segments = operation.path.split("/").filter((s) => s !== "" && !s.startsWith("{"));
    const resource = segments[segments.length - 1] ?? "record";
    return resource
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/s$/, "")
      .toLowerCase();
  }
  return stem.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/** `<br />` and friends out; whitespace collapsed. */
function tidySpecProse(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve one parameter's advertised description.
 *
 * Precedence, and the reason for each step:
 *   1. `describe[name]`        — human judgement always wins
 *   2. canonical fragment      — Page/PageSize/SearchQuery/OrderBy, one wording
 *   3. path GUID               — `GUID of the logical group.`
 *   4. exact-match filter      — detected from the vendor sentence, shortened
 *   5. short spec prose        — <= DERIVED_DESCRIPTION_LIMIT, tidied
 *   6. throw                   — see the header: refuse, do not copy
 */
function describeParameter(
  toolName: string,
  parameter: OperationParameter,
  operation: SpecOperation,
  describe: Record<string, string> | undefined
): string {
  const override = describe?.[parameter.name];
  if (override !== undefined) {
    return override;
  }

  const canonical = CANONICAL_DESCRIPTIONS[parameter.name];
  if (canonical !== undefined) {
    return canonical;
  }

  if (parameter.in === "path" && (parameter.format === "guid" || parameter.format === "uuid")) {
    return `GUID of the ${humaniseIdParameter(parameter.name, operation)}.`;
  }

  const prose = parameter.description ? tidySpecProse(parameter.description) : "";

  if (EXACT_MATCH_SENTENCE.test(prose)) {
    return `Exact-match filter on ${parameter.name}.`;
  }

  if (prose !== "" && prose.length <= DERIVED_DESCRIPTION_LIMIT) {
    return prose;
  }

  throw new Error(
    `defineTools: ${toolName} exposes "${parameter.name}" but has no wording for it. ` +
      (prose === ""
        ? "The spec gives none"
        : `The spec's is ${prose.length} B, over the ${DERIVED_DESCRIPTION_LIMIT} B limit`) +
      `. Add describe: { ${parameter.name}: "..." }, give it a canonical fragment in ` +
      "schema-fragments.ts, or drop it from `expose`."
  );
}

function propertyFor(
  parameter: OperationParameter,
  description: string
): SchemaProperty {
  return {
    type: parameter.type,
    description,
    ...(parameter.enum ? { enum: [...parameter.enum] } : {}),
    ...(parameter.items ? { items: parameter.items } : {}),
  };
}

function ruleFor(parameter: OperationParameter): ValidationRule {
  const canonical = CANONICAL_RULES[parameter.name];
  if (canonical !== undefined) {
    return canonical();
  }
  if (parameter.type === "string" && (parameter.format === "guid" || parameter.format === "uuid")) {
    return {
      name: parameter.name,
      required: parameter.required,
      type: "string",
      format: "guid",
      message: `${parameter.name} must be a valid GUID`,
    };
  }
  return {
    name: parameter.name,
    required: parameter.required,
    type: parameter.type,
    ...(parameter.enum ? { enum: [...parameter.enum] } : {}),
    ...(parameter.format === "date-time" || parameter.format === "date"
      ? { format: "iso-date" as const }
      : {}),
  };
}

function selectParameters(
  toolName: string,
  operation: SpecOperation,
  declaration: ToolDeclaration
): OperationParameter[] {
  const declared = new Map(operation.parameters.map((p) => [p.name, p]));

  if (declaration.expose !== undefined && declaration.omit !== undefined) {
    throw new Error(
      `defineTools: ${toolName} sets both \`expose\` and \`omit\`. Pick one — ` +
        "two answers to which parameters exist is how a schema drifts from its route."
    );
  }

  if (declaration.expose !== undefined) {
    const unknown = declaration.expose.filter((name) => !declared.has(name));
    if (unknown.length > 0) {
      throw new Error(
        `defineTools: ${toolName} exposes parameter(s) ${operation.operationId} does not declare: ` +
          `${unknown.join(", ")}. bConnect answers HTTP 200 and silently drops an unknown ` +
          "parameter (finding D6), so advertising one produces a confident wrong answer."
      );
    }
    const selected = declaration.expose.map((name) => declared.get(name)!);
    const droppedRequired = operation.parameters.filter(
      (p) => p.required && !declaration.expose!.includes(p.name)
    );
    if (droppedRequired.length > 0) {
      throw new Error(
        `defineTools: ${toolName} omits required parameter(s) of ${operation.operationId}: ` +
          `${droppedRequired.map((p) => p.name).join(", ")}. The route cannot be called without them.`
      );
    }
    return selected;
  }

  if (declaration.omit !== undefined) {
    const unknown = declaration.omit.filter((name) => !declared.has(name));
    if (unknown.length > 0) {
      throw new Error(
        `defineTools: ${toolName} omits parameter(s) ${operation.operationId} does not declare: ` +
          `${unknown.join(", ")}. A stale omit hides nothing and masks a real drop later.`
      );
    }
    const omitted = new Set(declaration.omit);
    const droppedRequired = operation.parameters.filter((p) => p.required && omitted.has(p.name));
    if (droppedRequired.length > 0) {
      throw new Error(
        `defineTools: ${toolName} omits required parameter(s) of ${operation.operationId}: ` +
          `${droppedRequired.map((p) => p.name).join(", ")}. The route cannot be called without them.`
      );
    }
    return operation.parameters.filter((p) => !omitted.has(p.name));
  }

  return [...operation.parameters];
}

function deriveWrapper(
  toolName: string,
  declaration: ToolDeclaration,
  index: OperationIndex
): { tool: DerivedTool; rules: ValidationRule[] } {
  const operation = requireOperation(index, declaration.op);

  const properties: SchemaProperties = {};
  const required: string[] = [];
  const rules: ValidationRule[] = [];

  for (const parameter of selectParameters(toolName, operation, declaration)) {
    const description = describeParameter(toolName, parameter, operation, declaration.describe);
    properties[parameter.name] = propertyFor(parameter, description);
    if (parameter.required) {
      required.push(parameter.name);
    }
    rules.push(ruleFor(parameter));
  }

  // ── Request body ──────────────────────────────────────────────────────────
  const body = operation.body;
  if (body !== undefined && !body.isArray && body.fields.length > 0) {
    const declared = new Map(body.fields.map((f) => [f.name, f]));
    const chosen = declaration.body ?? body.fields.map((f) => f.name);

    const unknown = chosen.filter((name) => !declared.has(name));
    if (unknown.length > 0) {
      throw new Error(
        `defineTools: ${toolName} declares body field(s) ${operation.operationId} does not have: ` +
          `${unknown.join(", ")}.`
      );
    }
    const missingRequired = body.fields.filter((f) => f.required && !chosen.includes(f.name));
    if (missingRequired.length > 0) {
      throw new Error(
        `defineTools: ${toolName} hides required body field(s) of ${operation.operationId}: ` +
          `${missingRequired.map((f) => f.name).join(", ")}. A caller cannot satisfy a field ` +
          "no schema advertises, so every call would 400."
      );
    }

    for (const name of chosen) {
      const field = declared.get(name)!;
      // Reused as a parameter so body fields and query parameters go through
      // exactly one wording resolver and one rule builder — a body field with
      // a different description policy from a query parameter is drift waiting
      // to happen. `in: "query"` only means "not a path segment" here.
      const asParameter: OperationParameter = {
        name: field.name,
        in: "query",
        required: field.required,
        type: field.type,
        ...(field.description !== undefined ? { description: field.description } : {}),
        ...(field.format ? { format: field.format } : {}),
        ...(field.enum ? { enum: field.enum } : {}),
        ...(field.items ? { items: field.items } : {}),
      };
      const description = describeParameter(toolName, asParameter, operation, declaration.describe);
      properties[field.name] = propertyFor(asParameter, description);
      if (field.required) {
        required.push(field.name);
      }
      rules.push(ruleFor(asParameter));
    }
  }

  // ── Local vocabulary ──────────────────────────────────────────────────────
  for (const shaping of declaration.shaping ?? []) {
    Object.assign(properties, SHAPING_FRAGMENTS[shaping]);
    rules.push(SHAPING_RULES[shaping]);
  }

  if (declaration.extra) {
    Object.assign(properties, declaration.extra);
  }
  for (const name of declaration.extraRequired ?? []) {
    if (!(name in properties)) {
      throw new Error(
        `defineTools: ${toolName} marks "${name}" required but declares no such property.`
      );
    }
    required.push(name);
  }

  return {
    tool: {
      name: toolName,
      description: declaration.description,
      inputSchema: {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    },
    rules,
  };
}

/**
 * Build a server's tool surface from declarations.
 *
 * @param index         the module's operation index
 * @param declarations  tool name → declaration, in the order to advertise
 *
 * @throws {Error} on any drift between a declaration and its operation. Every
 *                 throw here is a bug that would otherwise ship as a schema
 *                 quietly disagreeing with the route it calls.
 */
export function defineTools(
  index: OperationIndex,
  declarations: Record<string, ToolDeclaration | CompositeDeclaration>
): DeclaredTools {
  const tools: DerivedTool[] = [];
  const write: string[] = [];
  const rules = new Map<string, ValidationRule[]>();
  const routes = new Map<string, { method: string; path: string }>();

  for (const [toolName, declaration] of Object.entries(declarations)) {
    if (isComposite(declaration)) {
      tools.push({
        name: toolName,
        description: declaration.description,
        inputSchema: declaration.inputSchema,
      });
      rules.set(toolName, [...(declaration.rules ?? [])]);
      if (declaration.write) {
        write.push(toolName);
      }
      continue;
    }

    const derived = deriveWrapper(toolName, declaration, index);
    tools.push(derived.tool);
    rules.set(toolName, derived.rules);
    const operation = index.operations[declaration.op]!;
    routes.set(toolName, { method: operation.method, path: operation.path });
    if (declaration.write) {
      write.push(toolName);
    }
  }

  return {
    tools,
    write,
    rules,
    rulesFor(toolName: string): ValidationRule[] {
      return rules.get(toolName) ?? [];
    },
    validate(toolName: string, args: Record<string, unknown> | undefined): void {
      validateOrThrow(args, rules.get(toolName) ?? []);
    },
    routeFor(toolName: string) {
      return routes.get(toolName);
    },
  };
}
