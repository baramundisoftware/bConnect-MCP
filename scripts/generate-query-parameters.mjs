#!/usr/bin/env node
/**
 * Writes two tables for every server from openapi-specs/ and the server's
 * src/operations.ts:
 * - src/query-params.ts (#179, REQ-QA-001 AC 3): per bMS release and tool, the
 *   query parameters of the tool's GET operation, in spec order, each as the
 *   JSON-schema property the tool offers;
 * - src/tool-methods.ts (#296, REQ-SRV-024): per tool, the HTTP methods of its
 *   operations in either release, from which the core derives the tool's MCP
 *   annotations.
 * The specs aren't shipped with the servers, so the tables are generated and
 * committed; __tests__/query-params.guard.test.ts runs this script with --check
 * and fails when a table drifts.
 *
 *   node scripts/generate-query-parameters.mjs           write the tables
 *   node scripts/generate-query-parameters.mjs --check   compare only, exit 1 on a difference
 *
 * Rules:
 * - Page and PageSize use the shared core definitions; includeSubfolders on a
 *   route below a logical group uses the shared sub-group definition.
 * - Type from the spec (number → integer); an enum ($ref or allOf) is a string
 *   with its values listed.
 * - Description from the spec with HTML removed; a parameter the spec leaves
 *   undescribed gets a short one from FALLBACK.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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
        list.push({ domain, method: method.toUpperCase(), path, params: op.parameters ?? [], spec });
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

/** [tool, operationIds] for every line of the server's src/operations.ts. */
function toolsOf(server) {
  const ops = readFileSync(join(ROOT, server, "src", "operations.ts"), "utf8");
  return [...ops.matchAll(/^\s*([a-z0-9_]+):\s*\[([^\]]*)\]/gm)].map((m) => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1])]);
}

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

function toolTable(server, specs) {
  const domain = server.replace(/^bconnect-|-mcp$/g, "");
  const tools = toolsOf(server);
  const used = new Set();
  const releases = {};
  for (const release of RELEASES) {
    const rows = [];
    for (const [tool, ids] of tools) {
      const params = new Map();
      for (const id of ids) {
        for (const op of operationsOf(specs, release, domain, id).filter((o) => o.method === "GET")) {
          for (const p of op.params) {
            if (p.in === "query" && !params.has(p.name)) {params.set(p.name, property(p, op.path, op.spec));}
          }
        }
      }
      if (params.size === 0) {continue;}
      for (const v of params.values()) {if (/^[A-Z_]+$/.test(v)) {used.add(v);}}
      rows.push(`    ${tool}: {\n${[...params].map(([n, v]) => `      ${n}: ${v},`).join("\n")}\n    },`);
    }
    releases[release] = rows;
  }
  const imports = ["type QueryParameterTable", ...[...used].sort()];
  return `/**
 * GENERATED by scripts/generate-query-parameters.mjs from openapi-specs/ and
 * src/operations.ts — do not edit. Regenerate after a spec or operations.ts
 * change; __tests__/query-params.guard.test.ts fails when this table drifts.
 *
 * Per bMS release and tool: the query parameters of the tool's GET operation,
 * as the properties the tool offers (#179). Tools send exactly these.
 */
import { ${imports.join(", ")} } from "@bconnect/mcp-core";

export const QUERY_PARAMETERS: QueryParameterTable = {
${RELEASES.map((r) => `  "${r}": {\n${releases[r].join("\n")}\n  },`).join("\n")}
};
`;
}

/** src/tool-methods.ts: per tool, the sorted HTTP methods of its operations in either release. */
function methodTable(server, specs) {
  const domain = server.replace(/^bconnect-|-mcp$/g, "");
  const rows = toolsOf(server).map(([tool, ids]) => {
    const methods = new Set(RELEASES.flatMap((release) => ids.flatMap((id) => operationsOf(specs, release, domain, id).map((o) => o.method))));
    return `  ${tool}: [${[...methods].sort().map((m) => `"${m}"`).join(", ")}],`;
  });
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
for (const server of servers) {
  for (const [name, text] of [["query-params.ts", toolTable(server, specs)], ["tool-methods.ts", methodTable(server, specs)]]) {
    const file = join(ROOT, server, "src", name);
    // Read once (a missing file counts as empty) and compare without line-ending
    // differences: a Windows checkout has CRLF.
    const current = readIfPresent(file).replace(/\r\n/g, "\n");
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
  console.log(`query-params.ts, tool-methods.ts: up to date (${servers.length} servers)`);
} else {
  console.log(`query-params.ts, tool-methods.ts: ${stale.length} of ${servers.length * 2} files written`);
}
