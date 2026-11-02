/**
 * Generates the OpenAPI type files of the servers from openapi-specs/<release>/ (#335).
 *
 *   node scripts/generate-api-types.mjs          # write every file in TYPE_FILES
 *
 * Each server types its requests and responses with `paths`, `components` and
 * `operations` from src/generated/<domain>-types.ts, generated from the 26R1
 * specification, which covers every module. Routes that exist only in 25R2
 * (the Industrial endpoints) come from a second file generated from 25R2.
 * __tests__/generated-types.guard.test.ts fails when a file differs from what
 * this script generates, and when src/generated holds a file not listed here.
 *
 * No `#!` line: a test imports this module, and on a Windows checkout with CRLF
 * line endings that line ends in `\r`, which fails the import (SyntaxError).
 */
import { readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every generated type file: where it goes, and the release and module it comes from. */
export const TYPE_FILES = [
  ...[
    "activedirectory", "assets", "compliance", "defensecontrol", "endpoints", "jobs", "operatingsystems",
    "servermanagement", "software", "universaldynamicgroups", "updatemanagement", "variables",
  ].map((domain) => ({ file: `bconnect-${domain}-mcp/src/generated/${domain}-types.ts`, release: "26R1", module: domain })),
  // groups calls the endpoints API.
  { file: "bconnect-groups-mcp/src/generated/endpoints-types.ts", release: "26R1", module: "endpoints" },
  // The Industrial endpoint routes exist only in 25R2.
  { file: "bconnect-endpoints-mcp/src/generated/endpoints-25r2-types.ts", release: "25R2", module: "endpoints" },
  { file: "bconnect-groups-mcp/src/generated/endpoints-25r2-types.ts", release: "25R2", module: "endpoints" },
];

/** The specification file of `module` in `release` (the file names' case differs between releases). */
export function specFile(release, module) {
  const dir = join(ROOT, "openapi-specs", release);
  const name = readdirSync(dir).find((f) => f.toLowerCase() === `bconnect_${module}.json`);
  if (!name) {
    throw new Error(`openapi-specs/${release} has no specification for ${module}`);
  }
  return join(dir, name);
}

/** The contents a type file must have. */
export async function generate({ release, module }) {
  const spec = specFile(release, module);
  const ast = await openapiTS(pathToFileURL(spec));
  return (
    "/**\n" +
    ` * Generated from openapi-specs/${release}/${spec.split(/[\\/]/).pop()} by scripts/generate-api-types.mjs.\n` +
    " * Don't edit: change the specification or the script, then run `node scripts/generate-api-types.mjs`.\n" +
    " */\n\n" +
    astToString(ast)
  );
}

async function main() {
  for (const entry of TYPE_FILES) {
    writeFileSync(join(ROOT, entry.file), await generate(entry));
    console.log(`${entry.file}  ← ${entry.release} ${entry.module}`);
  }
}

// Run, unless a test imports it; a path through a symlink still counts as running it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`generate-api-types: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
