/**
 * Optional per-server credentials for the stdio deployment.
 *
 * The feature is opt-in and most deployments will never touch it, so the
 * assertions that matter most are the ones proving it stays invisible: with no
 * `__<SERVER>` variable set, resolution must be byte-identical to what it was
 * before this existed.
 *
 * Each guard below was falsified by breaking the thing it guards; the mutation
 * is named at the test.
 */
import { describe, it, expect } from "vitest";
import {
  describeCredentialSource,
  resolveClientConfig,
  resolveServerScopedCredentials,
  serverScope,
  serverScopedEnvKeys,
} from "../index.js";

const SHARED = {
  BCONNECT_BASE_URL: "https://bms.example.test/bconnect",
  BCONNECT_API_KEY: "shared-key",
} satisfies NodeJS.ProcessEnv;

/** resolveClientConfig with the boilerplate a caller must supply. */
function resolve(env: NodeJS.ProcessEnv, serverName?: string) {
  return resolveClientConfig({
    factory: (c) => c,
    env,
    serverName,
    onMissingCredentials: (reason) => { throw new Error(`missing: ${reason}`); },
  });
}

describe("the scope is the domain name, spelled as the gateway spells it", () => {
  it("derives the same token from a package name or a bare domain", () => {
    expect(serverScope("bconnect-jobs-mcp")).toBe("JOBS");
    expect(serverScope("jobs")).toBe("JOBS");
    expect(serverScope("bconnect-universaldynamicgroups-mcp")).toBe("UNIVERSALDYNAMICGROUPS");
  });

  it("names the four variables a deployer would set", () => {
    expect(serverScopedEnvKeys("bconnect-jobs-mcp")).toEqual({
      baseUrl: "BCONNECT_BASE_URL__JOBS",
      username: "BCONNECT_USERNAME__JOBS",
      password: "BCONNECT_PASSWORD__JOBS",
      apiKey: "BCONNECT_API_KEY__JOBS",
    });
  });
});

describe("unset means unchanged — the single-key deployment never meets this", () => {
  it("resolves nothing when no per-server variable is set", () => {
    expect(resolveServerScopedCredentials("bconnect-jobs-mcp", SHARED)).toBeUndefined();
  });

  it("gives the shared credential to a named server with no variable of its own", () => {
    // Falsified by having resolveServerScopedCredentials return an object
    // whenever a base URL exists: every server would then resolve a
    // credential-less scoped set and fail the credentials check.
    expect(resolve(SHARED, "bconnect-jobs-mcp").apiKey).toBe("shared-key");
  });

  it("is identical with and without a server name", () => {
    expect(resolve(SHARED, "bconnect-jobs-mcp")).toEqual(resolve(SHARED));
  });

  it("does not treat a base URL alone as a credential", () => {
    // A server told WHERE to go has not been told WHO to be. Returning a
    // scoped set here would pin it to the shared identity while looking
    // configured — and, worse, would suppress the shared credential under the
    // unit rule below.
    const env = { ...SHARED, BCONNECT_BASE_URL__JOBS: "https://other.test/bconnect" };
    expect(resolveServerScopedCredentials("bconnect-jobs-mcp", env)).toBeUndefined();
    expect(resolve(env, "bconnect-jobs-mcp").apiKey).toBe("shared-key");
  });
});

describe("a per-server key applies to that server and to no other", () => {
  const env = { ...SHARED, BCONNECT_API_KEY__JOBS: "jobs-key" };

  it("gives the named server its own key", () => {
    expect(resolve(env, "bconnect-jobs-mcp").apiKey).toBe("jobs-key");
  });

  it("leaves every other server on the shared key", () => {
    // The discriminating half. A resolver that read the variable without
    // matching the scope would hand `jobs-key` to all thirteen.
    expect(resolve(env, "bconnect-compliance-mcp").apiKey).toBe("shared-key");
    expect(resolve(env, "bconnect-endpoints-mcp").apiKey).toBe("shared-key");
  });

  it("inherits the shared base URL rather than demanding it twice", () => {
    expect(resolve(env, "bconnect-jobs-mcp").baseUrl).toBe(SHARED.BCONNECT_BASE_URL);
  });

  it("lets one server point at a different bMS when asked to", () => {
    const multi = { ...env, BCONNECT_BASE_URL__JOBS: "https://other.test/bconnect" };
    expect(resolve(multi, "bconnect-jobs-mcp").baseUrl).toBe("https://other.test/bconnect");
    expect(resolve(multi, "bconnect-compliance-mcp").baseUrl).toBe(SHARED.BCONNECT_BASE_URL);
  });
});

describe("credentials resolve as a UNIT, never field by field", () => {
  it("does not let a per-server basic credential inherit the shared API key", () => {
    // THE BUG THIS FILE EXISTS FOR, caught while writing the comment above the
    // code. With a per-field fallback chain the apiKey slot falls through to
    // the SHARED key — and a key beats basic auth downstream, so this server
    // would run on exactly the credential it was just configured away from.
    // Silent over-privilege, produced by the setting meant to prevent it.
    //
    // Falsified by restoring `scoped?.apiKey ?? env.BCONNECT_API_KEY`:
    // apiKey comes back as "shared-key" and this test goes red.
    const env = {
      ...SHARED,
      BCONNECT_USERNAME__JOBS: "svc_jobs",
      BCONNECT_PASSWORD__JOBS: "pw",
    };
    const config = resolve(env, "bconnect-jobs-mcp");
    expect(config.apiKey, "the shared API key must not leak into a basic-auth server").toBeUndefined();
    expect(config.username).toBe("svc_jobs");
    expect(config.password).toBe("pw");
  });

  it("does not let a per-server API key inherit shared basic credentials", () => {
    const env = {
      BCONNECT_BASE_URL: SHARED.BCONNECT_BASE_URL,
      BCONNECT_USERNAME: "shared_user",
      BCONNECT_PASSWORD: "shared_pw",
      BCONNECT_API_KEY__JOBS: "jobs-key",
    };
    const config = resolve(env, "bconnect-jobs-mcp");
    expect(config.apiKey).toBe("jobs-key");
    expect(config.username).toBeUndefined();
    expect(config.password).toBeUndefined();
  });
});

describe("injected credentials still win — the gateway is not second-guessed", () => {
  it("prefers what createServer was handed over any environment variable", () => {
    const env = { ...SHARED, BCONNECT_API_KEY__JOBS: "jobs-key" };
    const config = resolveClientConfig({
      factory: (c) => c,
      env,
      serverName: "bconnect-jobs-mcp",
      credentials: { apiKey: "injected-key", baseUrl: SHARED.BCONNECT_BASE_URL },
      onMissingCredentials: (reason) => { throw new Error(`missing: ${reason}`); },
    });
    expect(config.apiKey).toBe("injected-key");
  });
});

describe("the startup line names variables, never values", () => {
  it("reports which source supplied the credential", () => {
    expect(describeCredentialSource("bconnect-jobs-mcp", SHARED)).toBe("BCONNECT_API_KEY (shared)");
    expect(
      describeCredentialSource("bconnect-jobs-mcp", { ...SHARED, BCONNECT_API_KEY__JOBS: "k" }),
    ).toBe("BCONNECT_API_KEY__JOBS (per-server)");
    expect(describeCredentialSource("bconnect-jobs-mcp", {})).toBe("none");
  });

  it("carries no credential value in the description", () => {
    const SENTINEL = "s3cr3t-value-must-not-appear";
    const env = { ...SHARED, BCONNECT_API_KEY__JOBS: SENTINEL };
    expect(describeCredentialSource("bconnect-jobs-mcp", env)).not.toContain(SENTINEL);
  });
});
