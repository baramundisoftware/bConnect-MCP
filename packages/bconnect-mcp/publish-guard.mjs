/**
 * prepublishOnly (#297): the package is published only by the npm workflow
 * (.github/workflows/npm.yml), from GitHub Actions, with provenance and under the
 * dist-tag `next` while the project is a Technical Preview. A publish from a
 * developer's machine, or one that would move `latest`, stops here.
 */
const refuse = (reason) => {
  console.error(`@baramundi/bconnect-mcp: not published: ${reason}`);
  process.exit(1);
};
if (process.env.GITHUB_ACTIONS !== "true") {
  refuse("publish from the npm workflow (GitHub Actions) only, so the package has provenance.");
}
if (process.env.npm_config_tag !== "next") {
  refuse(`publish with --tag next (Technical Preview), not ${JSON.stringify(process.env.npm_config_tag ?? "latest")}.`);
}
