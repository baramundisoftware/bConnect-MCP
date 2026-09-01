#!/usr/bin/env node
/**
 * Emit the runtime operation index a server's declaration layer reads.
 *
 * ── Why a generated file and not a JSON import ──────────────────────────────
 * `src/generated/*-types.ts` is `openapi-typescript` output: types only, erased
 * at runtime. `defineTools()` needs to *read* the operation — route, verb,
 * parameter names, types, enums, required sets — so something has to survive
 * compilation. The specs themselves live at the repo root in `openapi-specs/`,
 * outside every package's `rootDir`, so a published server cannot resolve them
 * at runtime. This bakes the distilled index into the package instead.
 *
 * Distilled, not copied: the 26R1 compliance spec is 61 KB and its index is
 * about a tenth of that, because responses, examples, `x-` extensions and the
 * vendor prose the token findings measured are all dropped.
 *
 * ── The output is checked in ────────────────────────────────────────────────
 * Deliberately, and `src/__tests__/operation-index.test.ts` asserts the checked-in
 * file is byte-identical to a fresh run. That test is the codegen gap
 * CONTRIBUTING.md:33-34 already admits: without it, a hand-edit to a generated
 * file survives indefinitely and the spec stops being the source of truth.
 *
 *   npm run generate:operations   --prefix bconnect-compliance-mcp
 *   npm run generate:operations:check --prefix bconnect-compliance-mcp
 *
 * ── Where this file should live ────────────────────────────────────────────
 * In scripts/ at the repo root, folded into the suite-wide `npm run generate`,
 * as soon as a SECOND server adopts defineTools(). It sits in this package only
 * because compliance is the sole adopter today and a root-level script is
 * another agent's territory. TARGETS below is already a list for that reason.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOperationIndex, serializeOperationIndex } from "../../packages/mcp-core/build/operation-index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SPEC_DIR = path.join(ROOT, "openapi-specs", "26R1");

/**
 * package -> { spec, module, constant }.
 *
 * Only the servers that have actually adopted `defineTools()` appear here.
 * Emitting an index a server does not read would be dead weight in its bundle,
 * and would make the drift test pass for a file nothing depends on.
 */
export const TARGETS = [
  {
    pkg: "bconnect-compliance-mcp",
    spec: "bConnect_Compliance.json",
    module: "compliance",
    constant: "COMPLIANCE_OPERATIONS",
  },
];

export function render(target) {
  const document = JSON.parse(fs.readFileSync(path.join(SPEC_DIR, target.spec), "utf8"));
  const index = buildOperationIndex(document, target.module);
  const json = serializeOperationIndex(index);
  const ids = Object.keys(index.operations).sort();

  return (
    `/**\n` +
    ` * GENERATED FILE — do not edit.\n` +
    ` *\n` +
    ` *   source: openapi-specs/26R1/${target.spec}\n` +
    ` *   regenerate: node bconnect-compliance-mcp/scripts/generate-operation-index.mjs\n` +
    ` *   verify: node bconnect-compliance-mcp/scripts/generate-operation-index.mjs --check\n` +
    ` *\n` +
    ` * The distilled runtime view of the ${target.module} spec: route, verb,\n` +
    ` * parameter names, JSON types, required sets, enum values and request-body\n` +
    ` * fields. Everything else — responses, examples, x- extensions, prose over the\n` +
    ` * declaration layer's limit — is dropped. See packages/mcp-core/src/operation-index.ts.\n` +
    ` *\n` +
    ` * ${ids.length} operations: ${ids.join(", ")}\n` +
    ` */\n\n` +
    `import { deserializeOperationIndex, type OperationIndex } from "@bconnect/mcp-core";\n\n` +
    `/** Serialised so TypeScript does not deep-check a literal it cannot improve. */\n` +
    `const SERIALISED = ${JSON.stringify(json)};\n\n` +
    `export const ${target.constant}: OperationIndex = deserializeOperationIndex(SERIALISED);\n`
  );
}

export function outputPath(target) {
  return path.join(ROOT, target.pkg, "src", "generated", `${target.module}-operations.ts`);
}

if (process.argv[1] && process.argv[1].endsWith("generate-operation-index.mjs")) {
  const check = process.argv.includes("--check");
  let drift = 0;
  for (const target of TARGETS) {
    const file = outputPath(target);
    const next = render(target);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (check) {
      if (current !== next) {
        drift += 1;
        console.error(
          `DRIFT ${path.relative(ROOT, file)} — regenerate with ` +
            `\`node bconnect-compliance-mcp/scripts/generate-operation-index.mjs\``
        );
      }
      continue;
    }
    if (current === next) {
      console.log(`unchanged ${path.relative(ROOT, file)}`);
    } else {
      fs.writeFileSync(file, next);
      console.log(`wrote ${path.relative(ROOT, file)} (${next.length} B)`);
    }
  }
  if (check) {
    console.log(drift === 0 ? "operation indexes are up to date" : `${drift} file(s) drifted`);
    process.exit(drift === 0 ? 0 : 1);
  }
}
