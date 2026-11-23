/**
 * Bundles the command for the npm package (#297): core and the 13 domain servers
 * into one file, dist/cli.js. They aren't on npm, so they travel inside the package;
 * the third-party packages stay `dependencies` and are installed by npm as usual.
 *
 * Runs after `tsc` (prepack), from build/cli.js. The banner sets VITEST before any
 * bundled module runs, so the servers' own entry points don't start (domains.ts);
 * only external imports (the SDK, axios, …) are evaluated before it, and they don't
 * read it. Copies the repository's LICENSE next to package.json for the tarball.
 */
import { build } from "rolldown";
import { chmodSync, copyFileSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {});
const isExternal = (id) => id.startsWith("node:") || external.some((dep) => id === dep || id.startsWith(`${dep}/`));

await build({
  input: "build/cli.js",
  platform: "node",
  external: isExternal,
  logLevel: "warn",
  output: {
    file: "dist/cli.js",
    format: "esm",
    codeSplitting: false,
    banner: 'process.env.VITEST ??= "bconnect-mcp";',
  },
});
copyFileSync(new URL("../../LICENSE", import.meta.url), new URL("./LICENSE", import.meta.url));
chmodSync(new URL("./LICENSE", import.meta.url), 0o644);
