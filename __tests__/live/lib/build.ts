/**
 * Live tier: refuse to run against an outdated build (#273).
 *
 * The tier spawns each server's build/index.js, which loads the shared core from
 * packages/mcp-core/build. A source file newer than its package's build means the
 * run would test old code against a live bMS, so it stops first, naming the package.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface OutdatedBuild {
  /** The package directory, relative to the root (e.g. `packages/mcp-core`). */
  pkg: string;
  reason: string;
}

/** Source files compiled into the build: .ts/.mts/.cts under src/, without declarations and tests. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.[mc]?ts$/.test(e.name) && !/\.d\.[mc]?ts$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => !/[\\/](__tests__|__mocks__)[\\/]/.test(f));
}

/** The packages whose build/index.js is missing or older than one of their source files. */
export function outdatedBuilds(root: string, packages: string[]): OutdatedBuild[] {
  return packages.flatMap((pkg): OutdatedBuild[] => {
    const entry = join(root, pkg, 'build', 'index.js');
    if (!existsSync(entry)) return [{ pkg, reason: 'not built' }];
    const built = statSync(entry).mtimeMs;
    const newer = sourceFiles(join(root, pkg, 'src')).filter((f) => statSync(f).mtimeMs > built);
    return newer.length === 0 ? [] : [{
      pkg,
      reason: `build is older than ${newer.slice(0, 3).map((f) => relative(join(root, pkg), f)).join(', ')}${newer.length > 3 ? ` and ${newer.length - 3} more` : ''}`,
    }];
  });
}

/** Throws, before anything is sent, when a build is missing or outdated. */
export function checkBuilds(root: string, packages: string[]): void {
  const outdated = outdatedBuilds(root, packages);
  if (outdated.length > 0) {
    throw new Error(
      `The live tier would test an outdated build:\n${outdated.map((o) => `  ${o.pkg}: ${o.reason}`).join('\n')}\n` +
      'Run `npm run build` (it builds the shared core and every server), then start the tier again.',
    );
  }
}
