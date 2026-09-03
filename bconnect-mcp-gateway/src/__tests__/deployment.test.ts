/**
 * bconnect-mcp-gateway — the SHIPPED deployment artifacts (SEC-7).
 *
 * The finding was never in the code: gateway.ts always had a fail-closed guard.
 * It was in the two files an operator actually runs, which between them satisfied
 * that guard before anyone saw it —
 *
 *   docker-compose.gateway.yml   MCP_ALLOW_NO_AUTH: "true"
 *   bconnect-mcp-gateway/Dockerfile   ENV MCP_GATEWAY_BIND=0.0.0.0
 *
 * A unit test of the guard cannot catch that regression, because the guard was
 * correct. So the artifacts themselves are asserted here: this suite fails if
 * anyone re-adds the line that disarmed them.
 *
 * Deliberately plain text matching rather than a YAML parse. The COMMENTED-OUT
 * escape hatch is part of the contract — it has to remain documented and remain
 * inert — and a parser cannot see the difference between "absent" and "commented".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATEWAY_DIR = resolve(HERE, "..", "..");
const REPO_ROOT = resolve(GATEWAY_DIR, "..");

const compose = readFileSync(resolve(REPO_ROOT, "docker-compose.gateway.yml"), "utf8");
const dockerfile = readFileSync(resolve(GATEWAY_DIR, "Dockerfile"), "utf8");

/** Lines that are not comments — what actually takes effect. */
const effective = (text: string): string[] =>
  text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line));

describe("SEC-7 — the shipped compose no longer disarms the auth guard", () => {
  it("does not SET MCP_ALLOW_NO_AUTH anywhere that takes effect", () => {
    const live = effective(compose).filter((line) => line.includes("MCP_ALLOW_NO_AUTH"));
    expect(live).toEqual([]);
  });

  it("still DOCUMENTS MCP_ALLOW_NO_AUTH as a commented escape hatch", () => {
    // Removing the flag from the compose must not delete the knowledge that a
    // proxy deployment exists; the operator has to be able to find it.
    expect(compose).toMatch(/#\s*MCP_ALLOW_NO_AUTH:\s*"true"/);
  });

  it("makes MCP_GATEWAY_AUTH_TOKEN mandatory with compose's `:?` operator", () => {
    // `${VAR:?message}` makes `docker compose up` fail with that message rather
    // than start an unauthenticated gateway.
    expect(compose).toMatch(/MCP_GATEWAY_AUTH_TOKEN:\s*\$\{MCP_GATEWAY_AUTH_TOKEN:\?/);
  });

  it("tells the operator how to generate a token in the failure message", () => {
    // The `:?` message is the only thing a failed `docker compose up` prints, so
    // it has to carry the fix and not just the complaint.
    const line = compose.split(/\r?\n/).find((l) => /MCP_GATEWAY_AUTH_TOKEN:\s*\$\{/.test(l)) ?? "";
    expect(line).toMatch(/openssl rand/);
    expect(line).toMatch(/24/);
  });

  it("still publishes the host port on loopback by default", () => {
    expect(compose).toContain("${MCP_GATEWAY_HOST_BIND:-127.0.0.1}");
  });

  it("keeps the container bind at 0.0.0.0 — now legitimised by the token", () => {
    // Docker cannot route a published port to a loopback listener inside the
    // container, so this line has to stay. What changed is that it is no longer
    // paired with an assertion that nothing needs to authenticate.
    expect(effective(compose).join("\n")).toMatch(/MCP_GATEWAY_BIND:\s*"0\.0\.0\.0"/);
  });
});

describe("SEC-7 — the image defaults to a loopback bind", () => {
  it("does not ENV MCP_GATEWAY_BIND=0.0.0.0", () => {
    const live = effective(dockerfile).filter((line) => /ENV\s+MCP_GATEWAY_BIND/.test(line));
    expect(live).toEqual([]);
  });

  it("explains why, so the next person does not re-add it as a convenience", () => {
    expect(dockerfile).toMatch(/SEC-7/);
    expect(dockerfile).toMatch(/MCP_GATEWAY_AUTH_TOKEN/);
  });

  it("marks the image as containerised so the loopback footgun is diagnosable", () => {
    // A published port that cannot reach a loopback listener looks like a broken
    // container. gateway.ts uses this flag to say so in one line.
    expect(effective(dockerfile).join("\n")).toMatch(/ENV\s+MCP_GATEWAY_IN_CONTAINER=true/);
  });
});

// ─── SEC-8 · the certificate-validation off switch is annotated as one ───────
//
// The compose file gives every risky knob a 3-9 line rationale — MCP_GATEWAY_BIND,
// MCP_GATEWAY_AUTH_TOKEN, MCP_GATEWAY_ALLOWED_HOSTS, MCP_GATEWAY_TRUST_PROXY,
// MCP_ALLOW_NO_AUTH. NODE_TLS_REJECT_UNAUTHORIZED sat on a bare line next to
// BCONNECT_CA_CERT_PATH with nothing said about it, so the shortcut looked like
// a peer of the correct answer rather than the thing that turns off validation
// for the connection carrying the API key.

describe("SEC-8 — NODE_TLS_REJECT_UNAUTHORIZED is annotated, not bare", () => {
  /** The comment block immediately above `key:` in the environment section. */
  function commentAbove(key: string): string {
    const lines = compose.split(/\r?\n/);
    const at = lines.findIndex((line) => line.trimStart().startsWith(`${key}:`));
    expect(at, `${key} should be present in the compose file`).toBeGreaterThan(-1);
    const block: string[] = [];
    for (let i = at - 1; i >= 0 && /^\s*#/.test(lines[i]); i--) {
      block.unshift(lines[i]);
    }
    return block.join("\n");
  }

  it("keeps the safe default", () => {
    expect(effective(compose).join("\n")).toMatch(
      /NODE_TLS_REJECT_UNAUTHORIZED:\s*\$\{NODE_TLS_REJECT_UNAUTHORIZED:-1\}/,
    );
  });

  it("says what setting it to 0 actually does, and to what", () => {
    const note = commentAbove("NODE_TLS_REJECT_UNAUTHORIZED");
    expect(note).toMatch(/BCONNECT_API_KEY/);
    expect(note).toMatch(/every|EVERY/);
  });

  it("points at BCONNECT_CA_CERT_PATH as the answer instead", () => {
    expect(commentAbove("NODE_TLS_REJECT_UNAUTHORIZED")).toMatch(/BCONNECT_CA_CERT_PATH/);
  });
});

// ─── SEC-10 · the compose file documents the health response it now gets ─────

describe("SEC-10 — the documented /health response is the liveness one", () => {
  it("does not promise an unauthenticated caller a server count", () => {
    const documented = compose.split(/\r?\n/).filter((line) => /→ \{"status":"ok"/.test(line));
    expect(documented).not.toEqual([]);
    expect(documented[0]).not.toMatch(/count/);
  });
});
