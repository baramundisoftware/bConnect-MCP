#!/usr/bin/env node
/**
 * Writes the per-tool tables for every server from openapi-specs/ and the server's
 * src/operations.ts:
 * - src/query-params.ts (#179, REQ-QA-001 AC 3): per bMS release and tool, the
 *   query parameters of the tool's GET operation, in spec order, each as the
 *   JSON-schema property the tool offers;
 * - src/tool-methods.ts (#296, REQ-SRV-024): per tool, the HTTP methods of its
 *   operations in either release, from which the core derives the tool's MCP
 *   annotations;
 * - src/tool-releases.ts (#159, REQ-SRV-028): per tool, the releases in which
 *   each of its operations exists with the route the tool calls (the newest
 *   release's: 26R1's, else 25R2's); a release lists only those tools;
 * - src/tool-variants.ts (#174, REQ-SRV-029), only in a server with merged tools:
 *   per merged tool, its variants and their selector values.
 * A merged tool is written in operations.ts as one line per route (variant):
 * `'list_endpoints[type=WindowsEndpoint]': ['GetWindowsEndpoints']`, and
 * `'list_endpoints[type=]'` for the call without a type. Each variant gets its
 * own rows (query parameters, releases); the merged tool gets the union of its
 * variants' rows, methods and releases. Variants of one tool must have one
 * effect (read, write or destructive): the script stops otherwise, so a merged
 * tool can never mix reads and writes.
 * The specs aren't shipped with the servers, so the tables are generated and
 * committed; __tests__/query-params.guard.test.ts runs this script with --check
 * and fails when a table drifts.
 *
 *   node scripts/generate-query-parameters.mjs           write the tables
 *   node scripts/generate-query-parameters.mjs --check   compare only, exit 1 on a difference
 *   --root=<dir>                                         another tree (the guard's own tests)
 *
 * Rules:
 * - Page and PageSize use the shared core definitions; includeSubfolders on a
 *   route below a logical group uses the shared sub-group definition.
 * - A paged operation (Page and PageSize) whose 200 answer has totalItems also
 *   gets the client-side countOnly (#165), last; tools never send it.
 * - Type from the spec (number → integer); an enum ($ref or allOf) is a string
 *   with its values listed.
 * - Description from the spec with HTML removed; a parameter the spec leaves
 *   undescribed gets a short one from FALLBACK.
 * - A merged tool's property: the first variant's definition; where other
 *   variants describe it differently, the differing words follow, named by
 *   variant ("For type "WindowsEndpoint": …OperatingSystem, LastUser and…").
 *   Which variants take it is added by the core when the tool is listed, for
 *   the selected release.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_ARG = process.argv.find((a) => a.startsWith("--root="));
const ROOT = ROOT_ARG ? ROOT_ARG.slice("--root=".length) : join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASES = ["25R2", "26R1"];
const CHECK = process.argv.includes("--check");

const FALLBACK = {
  includeSubOrgUnits: "If true, sub organization units are also queried (default false).",
  includeSubfolders: "If true, items in sub-folders are also returned (default false).",
  includeSubFolders: "If true, items in sub-folders are also returned (default false).",
};

/** Spec text as plain text: line breaks become spaces, tags are removed until none is left, stray angle brackets go. */
function clean(s) {
  let text = String(s ?? "").replace(/<br\s*\/?>/gi, " ");
  let before;
  do {
    before = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== before);
  return text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

/** operationId → [{ domain, method, path, params, spec }] per release */
function loadSpecs(release) {
  const byId = new Map();
  const dir = join(ROOT, "openapi-specs", release);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const domain = file.replace(/^bConnect_/, "").replace(/\.json$/, "").toLowerCase();
    const spec = JSON.parse(readFileSync(join(dir, file), "utf8"));
    for (const [path, byMethod] of Object.entries(spec.paths ?? {})) {
      for (const [method, op] of Object.entries(byMethod)) {
        if (!op || typeof op !== "object" || !op.operationId) {continue;}
        const list = byId.get(op.operationId) ?? [];
        list.push({ domain, method: method.toUpperCase(), path, params: op.parameters ?? [], responses: op.responses ?? {}, spec });
        byId.set(op.operationId, list);
      }
    }
  }
  return byId;
}

function deref(spec, schema) {
  let s = schema ?? {};
  if (Array.isArray(s.allOf) && s.allOf.length === 1) {s = s.allOf[0];}
  while (s && s.$ref) {s = s.$ref.replace(/^#\//, "").split("/").reduce((n, k) => n[k], spec);}
  return s;
}

/** The operation's 200 answer is an object with totalItems (a page). */
function answersWithTotalItems(op) {
  return Object.values(op.responses["200"]?.content ?? {}).some((c) => "totalItems" in (deref(op.spec, c.schema).properties ?? {}));
}

/** The property source text for one query parameter. */
function property(param, route, spec) {
  if (param.name === "Page") {return "PAGE_PROPERTY";}
  if (param.name === "PageSize") {return "PAGE_SIZE_PROPERTY";}
  if (param.name === "includeSubfolders" && route.includes("/LogicalGroups/{")) {return "INCLUDE_SUBFOLDERS_PROPERTY";}
  const schema = deref(spec, param.schema);
  const out = {};
  if (Array.isArray(schema.enum)) {
    out.type = "string";
    out.enum = schema.enum;
  } else {
    out.type = schema.type === "number" ? "integer" : (schema.type ?? "string");
  }
  out.description = clean(param.description) || FALLBACK[param.name] || `Filters results by ${param.name}.`;
  return JSON.stringify(out);
}

/** [key, operationIds] for every line of the server's src/operations.ts; a key is a tool or a variant (`tool[type=X]`). */
function toolsOf(server) {
  const ops = readFileSync(join(ROOT, server, "src", "operations.ts"), "utf8");
  // Every entry line (`<key>: [...]`) must parse: a key in another quoting would otherwise be skipped silently.
  const entries = ops.split("\n").filter((line) => /^[ \t]*\S.*:[ \t]*\[.*\],?[ \t]*$/.test(line) && !/^[ \t]*(\*|\/\/)/.test(line));
  const parsed = entries.filter((line) => /^[ \t]*(?:'[a-z0-9_]+\[[^\]']*\]'|[a-z0-9_]+):[ \t]*\[/.test(line));
  if (parsed.length !== entries.length) {
    console.error(`${server}/src/operations.ts: can't read ${entries.filter((l) => !parsed.includes(l)).map((l) => l.trim()).join(" | ")}; write keys as name or 'name[selector=value]'.`);
    process.exit(1);
  }
  return [...ops.matchAll(/^[ \t]*(?:'([a-z0-9_]+\[[^\]']*\])'|([a-z0-9_]+)):[ \t]*\[([^\]]*)\]/gm)]
    .map((m) => [m[1] ?? m[2], [...m[3].matchAll(/'([^']+)'/g)].map((x) => x[1])]);
}

/** `list_endpoints[type=WindowsEndpoint]` → { tool: "list_endpoints", select: { type: "WindowsEndpoint" } }; a plain key → its own tool, no selectors. */
function variantOf(key) {
  const m = key.match(/^([a-z0-9_]+)\[(.*)\]$/);
  if (!m) {return { tool: key, select: null };}
  return { tool: m[1], select: Object.fromEntries(m[2].split(",").map((part) => {
    const [name, value] = part.split("=");
    return [name, value === "" ? null : value];
  })) };
}

/** `type "WindowsEndpoint"` / `without type`, as the core says it. */
const describeVariant = (select) => Object.entries(select).map(([n, v]) => (v === null ? `without ${n}` : `${n} "${v}"`)).join(" and ");

/**
 * Variants of a merged tool, named as briefly as the tool's variants in the release
 * (`universe`) allow, the same way the core names them: with two or more selectors, the
 * whole slices of one selector are named by the slice (`memberType "WindowsEndpoint",
 * "MacEndpoint"` = every variant with one of those member types; `without memberType`),
 * the rest one by one. A tool with one selector names each variant (REQ-SRV-029).
 */
function describeVariants(selects, universe) {
  const names = Object.keys(universe[0] ?? {});
  if (names.length < 2) {return selects.map(describeVariant).join(", ");}
  const same = (a, b) => names.every((n) => a[n] === b[n]);
  const chosen = (u) => selects.some((s) => same(s, u));
  let best = { covered: [], parts: [] };
  for (const n of names) {
    const values = [...new Set(universe.map((u) => u[n]))].filter((v) => universe.filter((u) => u[n] === v).every(chosen));
    const covered = universe.filter((u) => values.includes(u[n]));
    if (covered.length > best.covered.length) {
      const named = values.filter((v) => v !== null);
      best = { covered, parts: [...(named.length > 0 ? [`${n} ${named.map((v) => `"${v}"`).join(", ")}`] : []), ...(values.includes(null) ? [`without ${n}`] : [])] };
    }
  }
  const rest = selects.filter((s) => !best.covered.some((u) => same(s, u)));
  return [...best.parts, ...rest.map(describeVariant)].join("; ");
}

/** Per merged tool, its variant keys in operations.ts order. */
function mergedOf(keys) {
  const merged = new Map();
  for (const key of keys) {
    const { tool, select } = variantOf(key);
    if (select) {merged.set(tool, [...(merged.get(tool) ?? []), key]);}
  }
  return merged;
}

/** A table key as source text: quoted when it isn't a plain name. */
const keyText = (key) => (/^[a-z0-9_]+$/.test(key) ? key : JSON.stringify(key));

/** read, write or destructive, as the core's toolEffect derives it from the methods. */
const effectOf = (methods) => (methods.includes("DELETE") ? "destructive" : methods.some((m) => m !== "GET") ? "write" : "read");

/**
 * The spec operations behind one operationId: the server's own domain, or any
 * domain for a server without its own spec (groups uses endpoints). The same
 * operationId can exist in several specs (GetFolders).
 */
function operationsOf(specs, release, domain, id) {
  const all = specs[release].get(id) ?? [];
  const own = all.filter((o) => o.domain === domain);
  return own.length ? own : all;
}

/**
 * Per release and key: the releases in which every operation of the key exists with the
 * method and path the tool calls (the newest release's route: 26R1's, else 25R2's).
 */
function releasesOf(server, specs, ids) {
  const domain = server.replace(/^bconnect-|-mcp$/g, "");
  return RELEASES.filter((release) => ids.every((id) => {
    const newest = operationsOf(specs, "26R1", domain, id);
    const called = newest.length ? newest : operationsOf(specs, "25R2", domain, id);
    // Spec paths carry no domain segment: compare it too, so another domain's identical path doesn't count.
    return called.length > 0 && operationsOf(specs, release, domain, id).some((o) => called.some((c) => c.domain === o.domain && c.method === o.method && c.path === o.path));
  }));
}

/** The query-parameter rows of one key in one release: name → property source text (empty when it has none). */
function queryRow(server, specs, release, ids) {
  const domain = server.replace(/^bconnect-|-mcp$/g, "");
  const params = new Map();
  let page = false;
  for (const id of ids) {
    for (const op of operationsOf(specs, release, domain, id).filter((o) => o.method === "GET")) {
      for (const p of op.params) {
        if (p.in === "query" && !params.has(p.name)) {params.set(p.name, property(p, op.path, op.spec));}
      }
      page ||= answersWithTotalItems(op);
    }
  }
  if (page && params.has("Page") && params.has("PageSize")) {params.set("countOnly", "COUNT_ONLY_PROPERTY");}
  return params;
}

/**
 * The words of `other` that differ from `base`, with one word of context on each side and
 * "…" where text is left out: "…OperatingSystem, LastUser and…"; words `other` only drops
 * are named: "…OSVersionString, SerialNumber… (without OSVersionText,)". Split on spaces.
 */
function difference(base, other) {
  const a = base.split(" ");
  const b = other.split(" ");
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) {p++;}
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) {q++;}
  const from = Math.max(0, p - 1);
  const to = Math.min(b.length, b.length - q + 1);
  const shown = `${from > 0 ? "…" : ""}${b.slice(from, to).join(" ")}${to < b.length ? "…" : ""}`;
  // Only words left out: name them, the context alone wouldn't show it.
  return b.length - q - p > 0 ? shown : `${shown} (without ${a.slice(p, a.length - q).join(" ")})`;
}

/**
 * A merged tool's row in one release: the union of its variants' rows (those the release
 * has), in variant order, countOnly last. A property's definition is the first variant's;
 * where other variants describe it differently, the differing words follow, named by variant
 * (by slice, when a tool has two or more selectors: describeVariants).
 */
function mergedRow(keys, rows) {
  const out = new Map();
  const texts = new Map();
  for (const key of keys) {
    for (const [name, value] of rows.get(key) ?? []) {
      if (name === "countOnly") {continue;}
      if (!out.has(name)) {out.set(name, value); texts.set(name, new Map());}
      if (value.startsWith("{") && value !== out.get(name)) {
        const text = JSON.parse(value).description;
        const others = texts.get(name);
        others.set(text, [...(others.get(text) ?? []), variantOf(key).select]);
      }
    }
  }
  for (const [name, others] of texts) {
    if (others.size === 0) {continue;}
    const first = JSON.parse(out.get(name));
    const universe = keys.map((key) => variantOf(key).select);
    first.description = [first.description, ...[...others].map(([text, selects]) => `For ${describeVariants(selects, universe)}: ${difference(first.description, text)}`)].join(" ");
    out.set(name, JSON.stringify(first));
  }
  if (keys.some((key) => rows.get(key)?.has("countOnly"))) {out.set("countOnly", "COUNT_ONLY_PROPERTY");}
  return out;
}

function toolTable(server, specs) {
  const tools = toolsOf(server);
  const merged = mergedOf(tools.map(([key]) => key));
  const used = new Set();
  const releases = {};
  for (const release of RELEASES) {
    const rows = new Map(tools.map(([key, ids]) => [key, queryRow(server, specs, release, ids)]));
    const lines = [];
    const emit = (key, params) => {
      if (params.size === 0) {return;}
      for (const v of params.values()) {if (/^[A-Z_]+$/.test(v)) {used.add(v);}}
      lines.push(`    ${keyText(key)}: {\n${[...params].map(([n, v]) => `      ${n}: ${v},`).join("\n")}\n    },`);
    };
    for (const [key, ids] of tools) {
      const { tool } = variantOf(key);
      // The merged tool's row comes right before its first variant's.
      if (merged.get(tool)?.[0] === key) {
        const here = merged.get(tool).filter((k) => releasesOf(server, specs, tools.find(([x]) => x === k)[1]).includes(release));
        emit(tool, mergedRow(here, rows));
      }
      emit(key, rows.get(key));
    }
    releases[release] = lines;
  }
  const imports = ["type QueryParameterTable", ...[...used].sort()];
  return `/**
 * GENERATED by scripts/generate-query-parameters.mjs from openapi-specs/ and
 * src/operations.ts — do not edit. Regenerate after a spec or operations.ts
 * change; __tests__/query-params.guard.test.ts fails when this table drifts.
 *
 * Per bMS release and tool: the query parameters of the tool's GET operation,
 * as the properties the tool offers (#179). Tools send exactly these, except
 * the client-side countOnly (#165), which the core handles.
 */
import { ${imports.join(", ")} } from "@bconnect/mcp-core";

export const QUERY_PARAMETERS: QueryParameterTable = {
${RELEASES.map((r) => `  "${r}": {\n${releases[r].join("\n")}\n  },`).join("\n")}
};
`;
}

/** The sorted HTTP methods of one key's operations in either release. */
function methodsOf(server, specs, ids) {
  const domain = server.replace(/^bconnect-|-mcp$/g, "");
  return [...new Set(RELEASES.flatMap((release) => ids.flatMap((id) => operationsOf(specs, release, domain, id).map((o) => o.method))))].sort();
}

/** Stops when the variants of one merged tool differ in effect (a tool mixing reads and writes). */
function checkEffects(server, specs) {
  const tools = toolsOf(server);
  for (const [tool, keys] of mergedOf(tools.map(([key]) => key))) {
    const effects = new Set(keys.map((key) => effectOf(methodsOf(server, specs, tools.find(([k]) => k === key)[1]))));
    if (effects.size > 1) {
      const order = ["read", "write", "destructive"].filter((e) => effects.has(e));
      console.error(`${server}: ${tool} mixes ${order.join(" and ")} routes; a merged tool's variants must have one effect (REQ-SRV-029). Split it into separate tools.`);
      process.exit(1);
    }
  }
}

/** src/tool-methods.ts: per tool, the sorted HTTP methods of its operations in either release; a merged tool's are its variants'. */
function methodTable(server, specs) {
  const tools = toolsOf(server);
  const rows = [];
  const done = new Set();
  for (const [key] of tools) {
    const { tool } = variantOf(key);
    if (done.has(tool)) {continue;}
    done.add(tool);
    const ids = tools.filter(([k]) => variantOf(k).tool === tool).flatMap(([, x]) => x);
    rows.push(`  ${tool}: [${methodsOf(server, specs, ids).map((m) => `"${m}"`).join(", ")}],`);
  }
  return `/**
 * GENERATED by scripts/generate-query-parameters.mjs from openapi-specs/ and
 * src/operations.ts — do not edit. Regenerate after a spec or operations.ts
 * change; __tests__/query-params.guard.test.ts fails when this table drifts.
 *
 * Per tool: the HTTP methods of the operations it calls, in either bMS release.
 * The tool's MCP annotations (read-only, destructive) are derived from these
 * (REQ-SRV-024).
 */
import type { ToolMethodTable } from "@bconnect/mcp-core";

export const TOOL_METHODS: ToolMethodTable = {
${rows.join("\n")}
};
`;
}

/**
 * src/tool-releases.ts: per tool (and per variant of a merged tool), the releases in which
 * every operation exists with the method and path the tool calls. The tools call the newest
 * release's route (26R1's, else 25R2's): an operation whose route differs in a release (e.g.
 * PUT there, PATCH in 26R1) is missing there. A merged tool is in every release one of its
 * variants is in.
 */
function releaseTable(server, specs) {
  const tools = toolsOf(server);
  const merged = mergedOf(tools.map(([key]) => key));
  const of = new Map(tools.map(([key, ids]) => [key, releasesOf(server, specs, ids)]));
  const line = (key, releases) => `  ${keyText(key)}: [${releases.map((r) => `"${r}"`).join(", ")}],`;
  const rows = [];
  for (const [key] of tools) {
    const { tool } = variantOf(key);
    if (merged.get(tool)?.[0] === key) {
      rows.push(line(tool, RELEASES.filter((r) => merged.get(tool).some((k) => of.get(k).includes(r)))));
    }
    rows.push(line(key, of.get(key)));
  }
  return `/**
 * GENERATED by scripts/generate-query-parameters.mjs from openapi-specs/ and
 * src/operations.ts — do not edit. Regenerate after a spec or operations.ts
 * change; __tests__/query-params.guard.test.ts fails when this table drifts.
 *
 * Per tool: the bMS releases in which each of its operations exists with the
 * route the tool calls. The selected release lists only these tools and
 * refuses the others by name (REQ-SRV-028, #159).
 */
import type { ToolReleaseTable } from "@bconnect/mcp-core";

export const TOOL_RELEASES: ToolReleaseTable = {
${rows.join("\n")}
};
`;
}

/** src/tool-variants.ts, for a server with merged tools: per tool, its variant keys and their selector values. */
function variantTable(server) {
  const merged = mergedOf(toolsOf(server).map(([key]) => key));
  if (merged.size === 0) {return undefined;}
  const rows = [...merged].map(([tool, keys]) => `  ${tool}: {\n${keys.map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(variantOf(key).select).replace(/":/g, '": ').replace(/,"/g, ', "')},`).join("\n")}\n  },`);
  return `/**
 * GENERATED by scripts/generate-query-parameters.mjs from src/operations.ts —
 * do not edit. Regenerate after an operations.ts change;
 * __tests__/query-params.guard.test.ts fails when this table drifts.
 *
 * Per merged tool (REQ-SRV-029, #174): its routes (variants) and the selector
 * values that choose each; null means the argument is left out.
 */
import type { ToolVariantTable } from "@bconnect/mcp-core";

export const TOOL_VARIANTS: ToolVariantTable = {
${rows.join("\n")}
};
`;
}

/** The file's text, or "" when it doesn't exist; no separate existence check that could go stale. */
function readIfPresent(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {return "";}
    throw error;
  }
}

/** Writes through a temporary file in the same directory, then renames it into place. */
function writeAtomically(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { flag: "wx" });
  try {
    renameSync(temporary, file);
  } catch (error) {
    // E.g. the target is locked on Windows: leave no temporary file in src/.
    rmSync(temporary, { force: true });
    throw error;
  }
}

const specs = Object.fromEntries(RELEASES.map((r) => [r, loadSpecs(r)]));
const servers = readdirSync(ROOT).filter((d) => /^bconnect-.+-mcp$/.test(d) && existsSync(join(ROOT, d, "src", "operations.ts"))).sort();
const stale = [];
let files = 0;
for (const server of servers) {
  checkEffects(server, specs);
  const tables = [["query-params.ts", toolTable(server, specs)], ["tool-methods.ts", methodTable(server, specs)], ["tool-releases.ts", releaseTable(server, specs)], ["tool-variants.ts", variantTable(server)]];
  for (const [name, text] of tables) {
    const file = join(ROOT, server, "src", name);
    // Read once (a missing file counts as empty) and compare without line-ending
    // differences: a Windows checkout has CRLF.
    const current = readIfPresent(file).replace(/\r\n/g, "\n");
    // A server without merged tools has no tool-variants.ts; one left over is stale.
    if (text === undefined) {
      if (current !== "") {
        stale.push(`${server}/src/${name}`);
        if (!CHECK) {rmSync(file);}
      }
      continue;
    }
    files++;
    if (current === text) {continue;}
    stale.push(`${server}/src/${name}`);
    if (!CHECK) {writeAtomically(file, text);}
  }
}
if (CHECK) {
  if (stale.length) {
    console.log(`Out of date: ${stale.join(", ")}. Run node scripts/generate-query-parameters.mjs and commit.`);
    process.exit(1);
  }
  console.log(`query-params.ts, tool-methods.ts, tool-releases.ts, tool-variants.ts: up to date (${servers.length} servers)`);
} else {
  console.log(`query-params.ts, tool-methods.ts, tool-releases.ts, tool-variants.ts: ${stale.length} of ${files} files written`);
}
