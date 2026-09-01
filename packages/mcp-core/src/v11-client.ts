/**
 * bConnect v1.1 — the shared read-only client and its gate.
 *
 * ── Why this is in mcp-core, when the first slice deliberately kept it out ───
 * The Microsoft Update slice wrote this client local to
 * `bconnect-updatemanagement-mcp` on the argument that mcp-core's transport
 * asserts every request stays inside its module's `/<module>/v2.0/...` base
 * path, and teaching that guard a second URL model would weaken a security
 * control for the sake of code reuse.
 *
 * That argument was about the GUARD, not about the package. A second consumer
 * now exists (the endpoints inventory-scan slice), and the alternative to
 * sharing is a second hand-maintained copy — which is this project's single
 * most repeated defect: every hand-maintained parallel list here has drifted,
 * and the evaluation found drift in all of them.
 *
 * So the client is shared, and the guard is untouched. What keeps that honest
 * is structural rather than a comment: this client CANNOT express a v2.0
 * request. It takes a controller NAME, never a path; it always derives the
 * v1.1 root itself; it always appends `.json`; and it refuses any method but
 * GET. There is no argument you can pass it that reaches a `/<module>/v2.0/`
 * route, so it is not a way around `assertPathContained`. See the
 * `cannot-express-a-v2-path` tests, which try.
 *
 * ── Verified live against a bMS 26R1 (2026-08-03) ───────────────────────────
 *   GET /bConnect/v1.1/Version -> {"SupportedVersions":["1.0","1.1"],
 *                                  "CurrentVersion":"1.1"}
 * v1.1 addresses `/bConnect/v1.1/<Controller>.<format>` with NO module segment.
 *
 * ── Auth (bConnect_v1.1.pdf §4.1, all verified live) ────────────────────────
 *   - Basic auth ONLY. The v2.0 API key returns 401 on every v1.1 route.
 *   - The username MUST be UPN form (user@domain); a bare name returns 401.
 *   - Credentials must be ISO-8859-1 encoded before base64.
 *   - Credentials come from BCONNECT_V11_USERNAME / BCONNECT_V11_PASSWORD —
 *     deliberately separate names, so the v2.0 servers are unaffected. This
 *     module never reads BCONNECT_API_KEY.
 *
 * SAFETY: GET only. `request()` refuses any other method before it reads a
 * credential or opens a socket. v1.1 supports POST/PATCH/DELETE on some
 * controllers; none of them are reachable through this client.
 */

import axios from "axios";
import type { AxiosInstance } from "axios";
import { BConnectApiError, type ToolTextResult } from "./tool-error.js";

// ─── Gate ────────────────────────────────────────────────────────────────────

/** Env var that turns the v1.1 tools on. One spelling, suite-wide. */
export const ENABLE_V11_ENV = "BCONNECT_ENABLE_V11";

/**
 * Is the v1.1 surface available? Requires the explicit opt-in AND both
 * credentials: a deployment that cannot authenticate to v1.1 gets no v1.1
 * tools in tools/list and pays no token cost for them (the same reasoning as
 * the ALLOW_WRITE_OPERATIONS gate, TOK-20). Read per call, never cached, so a
 * test — or a long-lived process whose environment is re-read — can flip it.
 */
export function v11Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[ENABLE_V11_ENV] === "true" &&
    Boolean(env.BCONNECT_V11_USERNAME) &&
    Boolean(env.BCONNECT_V11_PASSWORD)
  );
}

/**
 * The refusal a caller gets for naming a v1.1 tool while the gate is shut.
 * Hiding a tool from tools/list is a token optimisation; this is the control.
 */
export function v11DisabledMessage(toolName: string): string {
  return (
    `bConnect v1.1 tool '${toolName}' is disabled. Set ${ENABLE_V11_ENV}=true and provide ` +
    `BCONNECT_V11_USERNAME (UPN form, e.g. user@domain) and BCONNECT_V11_PASSWORD to enable it. ` +
    `v1.1 uses Basic auth only — the v2.0 API key is not accepted — and is reachable on the ` +
    `management LAN only.`
  );
}

/**
 * `undefined` when the call may proceed; the refusal result when it names a
 * v1.1 tool and the gate is shut. Mirrors `catalogue.gateWriteTool()`.
 */
export function gateV11Tool(
  name: string,
  v11ToolNames: ReadonlySet<string>,
  env: NodeJS.ProcessEnv = process.env
): ToolTextResult | undefined {
  if (!v11ToolNames.has(name) || v11Enabled(env)) {
    return undefined;
  }
  return {
    content: [{ type: "text", text: v11DisabledMessage(name) }],
    isError: true,
  };
}

// ─── Failure-path messages ───────────────────────────────────────────────────
//
// These are the point of the slice, not an afterthought. Each failure mode is
// specific and diagnosable, so it is diagnosed — a bare "ECONNREFUSED" or
// "Unauthorized" tells the operator nothing they can act on.

/** Connection refused / timed out / unreachable: v1.1 is LAN-only. */
export function v11UnreachableMessage(detail: string): string {
  return (
    `Cannot reach the bConnect v1.1 interface (${detail}). v1.1 is LAN-only: it is not ` +
    `served through the bConnect gateway, so a gateway or WAN deployment cannot reach it. ` +
    `This tool needs a direct connection to the bMS on the management LAN.`
  );
}

/** 401: two distinct causes produce it, so both are named. */
export const V11_UNAUTHORIZED_MESSAGE =
  "bConnect v1.1 rejected the credentials (HTTP 401). Two causes produce this: " +
  "the account in BCONNECT_V11_USERNAME is not a member of the bConnect security group " +
  "on the bMS, or the username is not in UPN form (user@domain — v1.1 returns 401 for a " +
  "bare account name). Check both. The v2.0 API key is never accepted by v1.1.";

/** 400: v1.1 rejects unknown parameters instead of silently dropping them. */
export function v11BadRequestMessage(detail: string): string {
  return (
    "bConnect v1.1 rejected the request (HTTP 400). Unlike v2.0 — which answers 200 and " +
    "silently ignores an unknown query parameter — v1.1 rejects the whole request, so this " +
    "usually means a misspelt parameter name." +
    (detail ? ` Server detail: ${detail}` : "")
  );
}

/**
 * 404 on a v1.1 controller that filters by endpoint.
 *
 * Measured live 2026-08-03: `InventoryDataRegistryScans?EndpointId=<zero guid>`
 * answers 404 `{"Message":"Endpoint [id=...] not found or is not of type
 * WindowsEndpoint."}` — while an unknown PARAMETER answers 400. The two are
 * different questions and get different answers, so the distinction is worth
 * keeping: 404 here means the GUID was well-formed and no such Windows
 * endpoint exists, which is a thing the caller can fix by looking it up.
 */
export function v11NotFoundMessage(detail: string): string {
  return (
    "bConnect v1.1 found no such endpoint (HTTP 404). The id was a well-formed GUID but " +
    "does not name a Windows endpoint on this bMS — v1.1 inventory controllers serve Windows " +
    "endpoints only. Use list_endpoints (type: WindowsEndpoint) to get a valid id." +
    (detail ? ` Server detail: ${detail}` : "")
  );
}

/** Network error codes that mean "the LAN route is not there". */
const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNABORTED", // axios timeout
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

/**
 * Controller names this client will address. A conservative character class,
 * not a blocklist: v1.1 controllers are bare PascalCase identifiers, so
 * anything carrying a slash, a dot, a colon or an escape is not one. This is
 * the structural half of "cannot express a v2.0 path" — see the header.
 */
const CONTROLLER_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

// ─── Client ──────────────────────────────────────────────────────────────────

export interface V11ClientOptions {
  /**
   * The server's v2.0 axios instance. Used ONLY as the source of the base URL
   * and the httpsAgent (which carries the OS trust store / BCONNECT_CA_CERT_PATH
   * — a bare fetch against an internal CA fails with
   * UNABLE_TO_VERIFY_LEAF_SIGNATURE, the lesson jobs-mcp's v11 module learned).
   * No request is ever sent through it, so its default X-Api-Key header is
   * never sent beside Basic auth.
   */
  httpClient: AxiosInstance;
  /** Injected for tests. Defaults to process.env, read per request. */
  env?: NodeJS.ProcessEnv;
}

/** What the transport hands back. Status is never thrown by the transport. */
export interface V11TransportResponse {
  status: number;
  data: unknown;
}

export class V11Client {
  private readonly httpClient: AxiosInstance;
  private readonly env: NodeJS.ProcessEnv | undefined;

  constructor(options: V11ClientOptions) {
    this.httpClient = options.httpClient;
    this.env = options.env;
  }

  /** v1.1 root, derived from the same base URL the v2.0 client resolved. */
  root(): string {
    const baseUrl = String(this.httpClient.defaults.baseURL ?? "");
    if (!baseUrl) {
      throw new Error(
        "The bConnect base URL is empty, so the v1.1 root could not be derived. " +
          "Set BCONNECT_BASE_URL."
      );
    }
    // v2.0 base is https://host/bconnect ; v1.1 lives beside it, not under it.
    return baseUrl.replace(/\/$/, "").replace(/\/bconnect$/i, "") + "/bConnect/v1.1";
  }

  /**
   * The actual HTTP hop, isolated so tests can stub it
   * (vi.spyOn(V11Client.prototype, "transport")).
   * `validateStatus: () => true` — status mapping is request()'s job.
   */
  async transport(url: string, headers: Record<string, string>): Promise<V11TransportResponse> {
    const res = await axios.get(url, {
      headers,
      // Reuse the v2.0 agent: OS trust store + any BCONNECT_CA_CERT_PATH.
      httpsAgent: this.httpClient.defaults.httpsAgent,
      timeout: Number(this.httpClient.defaults.timeout) || 30000,
      // SECURITY: never follow a redirect. This request carries Basic auth for
      // a DOMAIN ACCOUNT — the highest-value credential in the deployment.
      // `follow-redirects` does strip Authorization across hosts, but relying
      // on a transitive dependency's allow-list to protect a domain password
      // is not a control; refusing to redirect at all is.
      maxRedirects: 0,
      validateStatus: () => true,
    });
    return { status: res.status, data: res.data };
  }

  /**
   * GET a v1.1 controller. Read-only by construction: any other method is
   * refused before credentials are read or a socket is opened, so the
   * guarantee holds even without credentials present.
   */
  async request(
    controller: string,
    params: Record<string, string | number | boolean | undefined> = {},
    opts: { method?: string } = {}
  ): Promise<unknown> {
    const method = (opts.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      throw new Error(
        `Refusing ${method} ${controller}: the bConnect v1.1 client is read-only by design. ` +
          "Only GET is implemented, and no write method will be."
      );
    }

    // Structural, not cosmetic: this is what makes the client incapable of
    // addressing a v2.0 module route, which is why sharing it in mcp-core does
    // not weaken assertPathContained. A caller cannot smuggle a path in here.
    if (!CONTROLLER_PATTERN.test(controller)) {
      throw new Error(
        `Refusing '${controller}': the bConnect v1.1 client addresses a controller by name, ` +
          "not by path. A value containing a separator is never a v1.1 controller."
      );
    }

    const env = this.env ?? process.env;
    const username = env.BCONNECT_V11_USERNAME;
    const password = env.BCONNECT_V11_PASSWORD;
    if (!username || !password) {
      throw new Error(
        "bConnect v1.1 needs Basic auth credentials: set BCONNECT_V11_USERNAME (UPN form) " +
          "and BCONNECT_V11_PASSWORD. The v2.0 API key is not accepted by v1.1."
      );
    }

    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    const url = `${this.root()}/${controller}.json${qs ? `?${qs}` : ""}`;

    // §4.1: ISO-8859-1 (latin1) encoding of the credentials, verified live.
    const auth = "Basic " + Buffer.from(`${username}:${password}`, "latin1").toString("base64");

    let res: V11TransportResponse;
    try {
      res = await this.transport(url, {
        Authorization: auth,
        Accept: "application/json",
        // bConnect answers 406 to brotli; Node/axios offer it by default.
        "Accept-Encoding": "gzip, deflate",
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code && UNREACHABLE_CODES.has(e.code)) {
        throw new Error(v11UnreachableMessage(e.code));
      }
      throw err;
    }

    if (res.status === 401) {
      // Deliberately a 401 BConnectApiError: per INT-53 that is a FAULT (no
      // argument the model picks will fix a credential), so it surfaces as a
      // protocol error — but carrying this diagnosis instead of "Unauthorized".
      throw new BConnectApiError(401, V11_UNAUTHORIZED_MESSAGE, { method: "GET", path: controller });
    }
    if (res.status === 400) {
      const detail = detailOf(res.data);
      // 400 is EXPECTED per INT-53: the caller can fix a parameter name, so it
      // comes back as a readable isError tool result.
      throw new BConnectApiError(400, v11BadRequestMessage(detail), {
        method: "GET",
        path: controller,
      });
    }
    if (res.status === 404) {
      // Also EXPECTED: the caller can look up a real endpoint id.
      throw new BConnectApiError(404, v11NotFoundMessage(detailOf(res.data)), {
        method: "GET",
        path: controller,
      });
    }
    if (res.status < 200 || res.status >= 300) {
      throw new BConnectApiError(
        res.status,
        `bConnect v1.1 GET ${controller} returned HTTP ${res.status}.`,
        { method: "GET", path: controller }
      );
    }
    return res.data;
  }
}

/**
 * Server detail out of a v1.1 error body, capped.
 *
 * v1.1 answers errors as either a bare string or `{"Message":"..."}` — both
 * observed live on 2026-08-03 — so both are read rather than one being assumed.
 */
function detailOf(data: unknown): string {
  if (typeof data === "string") {
    return data.slice(0, 300);
  }
  const message = (data as { Message?: unknown } | null)?.Message;
  return typeof message === "string" ? message.slice(0, 300) : "";
}
