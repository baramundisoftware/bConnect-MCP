/**
 * One tool per operation, its route chosen by arguments (REQ-SRV-029, #174, ADR-0015).
 *
 * A merged tool (e.g. list_endpoints) has one route per variant, written in the
 * server's operations.ts as `list_endpoints[type=WindowsEndpoint]` and
 * `list_endpoints[type=]` (type left out). The generator writes the variants
 * and their selector values into the server's src/tool-variants.ts, and each
 * variant's releases into src/tool-releases.ts. The core then:
 * - lists each selector with only the values the selected release has, and says
 *   which variants take a property not all of them take (`withVariantSelectors`);
 * - refuses, before anything is sent, a call no variant of the release takes
 *   (`withToolVariants`); the server's dispatch reads the variant with `variantKey`;
 * - answers a removed tool name with its replacement (`refuseReplacedTool`).
 */
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { releaseDescription, releaseRefusal, selectedRelease, type ToolReleaseTable } from "./release.js";

/** A variant's selector values; null means the argument is left out. */
export type VariantSelect = Readonly<Record<string, string | null>>;

/** Per merged tool: its variant keys and their selector values (generated into src/tool-variants.ts). */
export type ToolVariantTable = Readonly<Record<string, Readonly<Record<string, VariantSelect>>>>;

/** The arguments a variant takes besides its selectors: path arguments, query parameters, body fields. */
export type VariantArguments = (key: string) => readonly string[];

/** A removed tool: the tool that replaces it, the variant to call, and arguments that were renamed (old → new). */
export interface ReplacedTool {
  tool: string;
  variant: string;
  rename?: Readonly<Record<string, string>>;
}

/** Per removed tool name: its replacement (src/replaced-tools.ts of a server). */
export type ReplacedToolTable = Readonly<Record<string, ReplacedTool>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `type "WindowsEndpoint"`, `without type`, `kind "Static" and member "Red"`, `kind "Static" without member`. */
export function describeVariant(select: VariantSelect): string {
  return Object.entries(select)
    .map(([name, value]) => (value === null ? `without ${name}` : `${name} "${value}"`))
    .reduce((text, part) => (text === "" ? part : `${text}${part.startsWith("without ") ? " " : " and "}${part}`), "");
}

const sameVariant = (names: readonly string[], a: VariantSelect, b: VariantSelect): boolean => names.every((n) => a[n] === b[n]);

/** The whole slices of one selector that `selects` cover (named), and the variants left over. */
function slices(selects: readonly VariantSelect[], universe: readonly VariantSelect[]): { parts: string[]; rest: VariantSelect[] } {
  const names = Object.keys(universe[0] ?? {});
  const chosen = (u: VariantSelect): boolean => selects.some((s) => sameVariant(names, s, u));
  let best: { covered: VariantSelect[]; parts: string[] } = { covered: [], parts: [] };
  for (const n of names) {
    const values = [...new Set(universe.map((u) => u[n]))].filter((v) => universe.filter((u) => u[n] === v).every(chosen));
    const covered = universe.filter((u) => values.includes(u[n]));
    if (covered.length > best.covered.length) {
      const named = values.filter((v): v is string => v !== null);
      best = { covered, parts: [...(named.length > 0 ? [`${n} ${named.map((v) => `"${v}"`).join(", ")}`] : []), ...(values.includes(null) ? [`without ${n}`] : [])] };
    }
  }
  return { parts: best.parts, rest: selects.filter((s) => !best.covered.some((u) => sameVariant(names, s, u))) };
}

/**
 * Variants of a merged tool, named as briefly as the tool's variants in the release
 * (`universe`) allow: with two or more selectors, the whole slices of one selector are named
 * by the slice (`memberType "WindowsEndpoint", "MacEndpoint"` = every variant with one of
 * those member types; `without memberType`), the rest one by one; parts joined with "; ".
 * A tool with one selector names each variant. The generator names them the same way.
 */
export function describeVariants(selects: readonly VariantSelect[], universe: readonly VariantSelect[]): string {
  if (Object.keys(universe[0] ?? {}).length < 2) {
    return selects.map(describeVariant).join("; ");
  }
  const { parts, rest } = slices(selects, universe);
  return [...parts, ...rest.map(describeVariant)].join("; ");
}

/**
 * Which of a tool's variants take a property, for its description: "Only for …", or, with
 * two or more selectors, "Not for …" when the variants that don't take it are whole slices
 * and that is shorter.
 */
function takenBy(taking: readonly VariantSelect[], universe: readonly VariantSelect[]): string {
  const only = `Only for ${describeVariants(taking, universe)}.`;
  const names = Object.keys(universe[0] ?? {});
  if (names.length < 2) {
    return only;
  }
  const others = slices(universe.filter((u) => !taking.some((t) => sameVariant(names, t, u))), universe);
  const not = `Not for ${others.parts.join("; ")}.`;
  return others.rest.length === 0 && not.length < only.length ? not : only;
}

/** The selector values of a variant key: `tool[type=X]` → { type: "X" }; `tool[type=]` → { type: null }. */
export function variantSelect(key: string): VariantSelect {
  // Plain string search, no regex: the key can come from a caller's table (linear time, no backtracking).
  const open = key.indexOf("[");
  if (open < 0 || !key.endsWith("]")) {
    return {};
  }
  const inner = key.slice(open + 1, -1);
  return Object.fromEntries(inner.split(",").map((part) => {
    const [name, value = ""] = part.split("=");
    return [name, value === "" ? null : value];
  }));
}

const variantsOf = (table: ToolVariantTable, tool: string): Array<[string, VariantSelect]> =>
  Object.hasOwn(table, tool) ? Object.entries(table[tool]) : [];

const inRelease = (releases: ToolReleaseTable, key: string, release: string): boolean =>
  Object.hasOwn(releases, key) && releases[key].some((r) => r === release);

const selectorsOf = (variants: Array<[string, VariantSelect]>): string[] =>
  [...new Set(variants.flatMap(([, select]) => Object.keys(select)))];

/** The variant `args` select for `tool` (an omitted selector is null); undefined for no match or a tool without variants. */
export function variantKey(table: ToolVariantTable, tool: string, args: Record<string, unknown> | undefined): string | undefined {
  return variantsOf(table, tool).find(([, select]) => Object.entries(select).every(([name, value]) => (args?.[name] ?? null) === value))?.[0];
}

/**
 * Wraps a server's tools/list handler: each merged tool's selector properties
 * list only the values with a route in the selected release; a property only
 * some of the release's variants take says which ("Only for type "X"."); one
 * that only another release's variants take is left out. Read per request.
 */
export function withVariantSelectors<Result extends { tools: object[] }>(
  table: ToolVariantTable,
  releases: ToolReleaseTable,
  argumentsOf: VariantArguments,
  handler: () => Result | Promise<Result>,
): () => Promise<Result> {
  return async () => {
    const result = await handler();
    const release = selectedRelease();
    return {
      ...result,
      tools: result.tools.map((tool) => {
        if (!("name" in tool) || typeof tool.name !== "string" || !("inputSchema" in tool) || !isRecord(tool.inputSchema) || !isRecord(tool.inputSchema.properties)) {
          return tool;
        }
        const variants = variantsOf(table, tool.name);
        if (variants.length === 0) {
          return tool;
        }
        const here = variants.filter(([key]) => inRelease(releases, key, release));
        const selectors = selectorsOf(variants);
        const anyTakes = new Set(variants.flatMap(([key]) => argumentsOf(key)));
        const properties: Record<string, unknown> = {};
        for (const [name, property] of Object.entries(tool.inputSchema.properties)) {
          if (selectors.includes(name)) {
            const values = [...new Set(here.map(([, select]) => select[name]).filter((v): v is string => typeof v === "string"))];
            properties[name] = { ...(isRecord(property) ? property : {}), enum: values };
            continue;
          }
          if (!anyTakes.has(name)) {
            properties[name] = property;
            continue;
          }
          const taking = here.filter(([key]) => argumentsOf(key).includes(name));
          if (taking.length === 0) {
            continue;
          }
          if (taking.length === here.length || !isRecord(property)) {
            properties[name] = property;
            continue;
          }
          const only = takenBy(taking.map(([, select]) => select), here.map(([, select]) => select));
          properties[name] = { ...property, description: `${typeof property.description === "string" ? property.description : ""} ${only}`.trim() };
        }
        const required = Array.isArray(tool.inputSchema.required)
          ? tool.inputSchema.required.filter((name: unknown) => typeof name === "string" && Object.hasOwn(properties, name))
          : undefined;
        return { ...tool, inputSchema: { ...tool.inputSchema, properties, ...(required && { required }) } };
      }),
    };
  };
}

/** Throws InvalidParams (or a release refusal) when no variant of the selected release takes this call. */
function checkVariant(table: ToolVariantTable, releases: ToolReleaseTable, argumentsOf: VariantArguments, tool: string, args: Record<string, unknown>): void {
  const variants = variantsOf(table, tool);
  const release = selectedRelease();
  const here = variants.filter(([key]) => inRelease(releases, key, release));
  const selectors = selectorsOf(variants);
  const refuse = (message: string): never => {
    throw new McpError(ErrorCode.InvalidParams, message);
  };
  for (const name of selectors) {
    const value = args[name];
    if (value === undefined) {
      if (!variants.some(([, select]) => select[name] === null)) {
        const values = [...new Set(here.map(([, select]) => select[name]).filter((v): v is string => typeof v === "string"))];
        refuse(`${tool} needs ${name}: one of ${values.join(", ")}.`);
      }
      continue;
    }
    if (typeof value !== "string" || !variants.some(([, select]) => select[name] === value)) {
      const values = [...new Set(here.map(([, select]) => select[name]).filter((v): v is string => typeof v === "string"))];
      refuse(`Unknown ${name} for ${tool}: ${JSON.stringify(value)}. bMS ${release} offers: ${values.join(", ")}.`);
    }
  }
  const key = variantKey(table, tool, args);
  if (key === undefined) {
    const given = Object.fromEntries(selectors.map((name) => [name, typeof args[name] === "string" ? args[name] : null]));
    const first = selectors[0];
    const same = here.filter(([, select]) => select[first] === given[first]);
    return refuse(`${tool} has no route for ${describeVariant(given)}. Valid on bMS ${release}: ${(same.length > 0 ? same : here).map(([, select]) => describeVariant(select)).join("; ")}.`);
  }
  const chosen = key;
  const select = table[tool][chosen];
  if (!inRelease(releases, chosen, release)) {
    refuse(releaseRefusal(`${tool} with ${describeVariant(select)}`, (releases[chosen] ?? []).join(" or ")));
  }
  // An argument another variant takes and this one doesn't; one no variant declares is left to the
  // declared-arguments check, which names what the tool accepts (REQ-SRV-022).
  const mine = new Set(argumentsOf(chosen));
  const problems = Object.keys(args).filter((name) => !selectors.includes(name) && !mine.has(name)).flatMap((name) => {
    const taking = variants.filter(([key]) => argumentsOf(key).includes(name));
    if (taking.length === 0) {
      return [];
    }
    const listed = taking.filter(([key]) => inRelease(releases, key, release));
    const universe = (listed.length > 0 ? here : variants).map(([, s]) => s);
    return [`${name} is not available for ${tool} with ${describeVariant(select)} (only with ${describeVariants((listed.length > 0 ? listed : taking).map(([, s]) => s), universe)}).`];
  });
  if (problems.length > 0) {
    // "with without type" reads "without type".
    refuse(problems.join(" ").replace(/ with without /g, " without "));
  }
}

/**
 * Wraps a server's CallTool handler: a call to a merged tool is checked against
 * its variants for the selected release before the handler runs, so nothing is
 * sent for a value the release lacks, an unsupported combination, or an argument
 * only another variant takes. Calls to other tools pass unchanged.
 */
export function withToolVariants<Request extends { params: { name: string; arguments?: Record<string, unknown> } }, Rest extends unknown[], Result>(
  table: ToolVariantTable,
  releases: ToolReleaseTable,
  argumentsOf: VariantArguments,
  handler: (request: Request, ...rest: Rest) => Promise<Result>,
): (request: Request, ...rest: Rest) => Promise<Result> {
  return async (request, ...rest) => {
    const { name, arguments: args } = request.params;
    if (Object.hasOwn(table, name)) {
      checkVariant(table, releases, argumentsOf, name, args ?? {});
    }
    return handler(request, ...rest);
  };
}

/** `with type "X"` / `without type`, joined with "and": how to call a variant. */
const howToCall = (select: VariantSelect): string =>
  Object.entries(select).map(([name, value]) => (value === null ? `without ${name}` : `with ${name} "${value}"`)).join(" and ");

/**
 * A removed tool name is refused with its replacement and the arguments to use
 * (MethodNotFound): "list_windows_endpoints was replaced by list_endpoints: call
 * list_endpoints with type "WindowsEndpoint"." When the selected release lacks
 * that route, it says so. No aliases: the old name never runs.
 */
export function refuseReplacedTool(replaced: ReplacedToolTable, releases: ToolReleaseTable, name: string): void {
  if (!Object.hasOwn(replaced, name)) {
    return;
  }
  const { tool, variant, rename } = replaced[name];
  const renamed = rename && Object.keys(rename).length > 0
    ? `, with ${Object.entries(rename).map(([from, to]) => `${to} (was ${from})`).join(" and ")}`
    : "";
  let message = `${name} was replaced by ${tool}: call ${tool} ${howToCall(variantSelect(variant))}${renamed}.`;
  if (!inRelease(releases, variant, selectedRelease())) {
    message += ` That route is only available in bMS ${(releases[variant] ?? []).join(" or ")}; this server uses ${releaseDescription()}.`;
  }
  throw new McpError(ErrorCode.MethodNotFound, message);
}
