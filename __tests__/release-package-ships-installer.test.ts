import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The release archive is the install route the README recommends over building
 * from source, so whatever the installer documentation describes has to be
 * inside it.
 *
 * It was not. `scripts/release.sh` contained no reference to `install/` at all
 * and heredoc'd a bare-bones INSTALL.md of its own covering `npm ci`, copying
 * `.env.example` and `node build/index.js` — so the customer who took the
 * recommended path lost the PowerShell installer, DPAPI credential storage, host
 * auto-detection, the write-gate confirmation and uninstall, silently and with
 * no error. Nothing failed, which is why five passes did not see it.
 *
 * This reads the script rather than running it: a real run needs `npm ci`, a
 * full build and `zip`, and the property worth pinning is what the script says
 * it packages. The script's own `die` on a missing installer covers the case
 * where the directory has moved and this file cannot see it — the two together
 * are the guard, and neither alone is.
 */

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/release.sh');

/**
 * Files without which the installer is not the installer. `hosts.json` is the
 * host catalogue every non-Claude target is emitted from; `merge-config.mjs` and
 * `verify-install.mjs` are the write and the verify halves.
 */
const REQUIRED_IN_PACKAGE = [
  'Install-BConnectMcp.ps1',
  'Install-BConnectMcp-UI.ps1',
  'INSTALL.md',
  'bconnect.ps1',
  'lib/hosts.json',
  'lib/merge-config.mjs',
  'lib/verify-install.mjs',
];

describe('the release package contains the installer it tells customers to use', () => {
  const script = readFileSync(SCRIPT, 'utf8');

  it('resolves an install directory and refuses to build without one', () => {
    expect(script, 'release.sh must locate install/ rather than ignore it').toMatch(/INSTALL_SRC/);
    // Resolved, not hardcoded: install/ sits beside the suite today and inside
    // it after the layout change, and a package built after the move must not
    // quietly lose it.
    expect(script).toMatch(/"install"\s+"\.\.\/install"/);
    expect(
      script,
      'a missing installer must stop the build — a package without it is the defect this guards'
    ).toMatch(/die "installer not found/);
  });

  it('asserts each essential installer file landed in the package', () => {
    for (const rel of REQUIRED_IN_PACKAGE) {
      expect(script, `release.sh must verify install/${rel} is in the package`).toContain(`install/${rel}`);
    }
  });

  it('does not fabricate an INSTALL.md that omits the installer', () => {
    const heredoc = script.match(/<<'INSTALLEOF'([\s\S]*?)INSTALLEOF/);
    expect(heredoc, 'release.sh still writes a root INSTALL.md').not.toBeNull();
    const generated = (heredoc as RegExpMatchArray)[1];
    expect(
      generated,
      'the generated root INSTALL.md must route Windows readers at the real installer'
    ).toMatch(/Install-BConnectMcp\.ps1/);
    expect(generated).toMatch(/install\/INSTALL\.md/);
    // The manual path stays: the installer is PowerShell-on-Windows and a Linux
    // or macOS deployer has nothing else to be pointed at.
    expect(generated).toMatch(/npm ci --omit=dev/);
  });

  it('every file it promises to verify actually exists to be packaged', () => {
    // Guards the guard. The script copies git-TRACKED files, so an assertion
    // naming a path that is untracked or renamed would fail the release rather
    // than pass this test — but a path that does not exist at all would make
    // both meaningless.
    const installDir = ['install', '../install']
      .map((c) => join(ROOT, c))
      .find((c) => existsSync(join(c, 'Install-BConnectMcp.ps1')));
    expect(installDir, 'no install/ directory beside or inside the suite').toBeDefined();
    for (const rel of REQUIRED_IN_PACKAGE) {
      expect(existsSync(join(installDir as string, rel)), `${rel} is missing from ${installDir}`).toBe(true);
    }
  });
});
