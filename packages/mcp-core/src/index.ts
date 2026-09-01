// @bconnect/mcp-core — shared utils.
//
// ── Client infrastructure ──
export * from "./audit-logger.js";
export * from "./batch-operations.js";
export * from "./paginate.js";
export * from "./parameter-validator.js";
export * from "./path-guard.js";
export * from "./protocol-error.js";
export * from "./security-routes.js";
export * from "./response-cache.js";
export * from "./rate-limiter.js";
export * from "./serialize.js";
export * from "./bconnect-client-base.js";
export * from "./client-provider.js";
export * from "./server-scoped-credentials.js";

// ── Schema / response composition (TOK-30) ──
//
// The four token findings all needed a home and none of them had one. Read each
// module's header before use — every one records the measurement that justifies
// it and the mistake it is built to prevent:
//
//   tool-catalogue.ts    declare read and write tools separately, so the 93 write
//                        schemas (45,154 B / ~11k tokens) are not advertised when
//                        ALLOW_WRITE_OPERATIONS is not "true"      (TOK-1/TOK-20)
//   schema-fragments.ts  one canonical wording for pagination, filters and ids —
//                        and one answer to the suite's 1-based/zero-indexed
//                        `Page` contradiction: zero-indexed       (TOK-10/TOK-29)
//   shape-response.ts    per-tool, opt-in compact projections with a lossless
//                        `meta` and an exact `detail: true` escape hatch
//                                                     (TOK-2/-4/-5/-7 = 21/23/24/27)
//   count-only.ts        "how many?" for ~122 bytes instead of a 15-18 KB page
//                                                                  (TOK-8/TOK-25)
//   tool-error.ts        one error channel: expected API failures (400/403/404/429)
//                        come back as isError tool results everywhere; faults stay
//                        protocol errors                          (INT-11/INT-53)
export * from "./tool-catalogue.js";
export * from "./schema-fragments.js";
export * from "./shape-response.js";
export * from "./count-only.js";
export * from "./tool-error.js";
// M5 — the absent/empty/zero policy. Opt-in per route; read the header before
// applying it anywhere new, in particular why it is not a client-wide rule.
// sub-resource-audit.ts is how a suite guard tells a route that declared what
// its 404 means from one nobody has looked at yet (ARCH-1).
export * from "./absent-data.js";
export * from "./sub-resource-audit.js";

// ── Declaration layer (OPT-31) ───────────────────────────────────────────────
//
// A tool is currently written out four times — tools/list entry, CallTool case
// arm, module method, validation rule — and three of the four restate one
// OpenAPI operation. These two modules let a server declare it once:
//
//   operation-index.ts   distils an OpenAPI document into the facts a schema is
//                        built from. `src/generated/*-types.ts` is types-only
//                        and erases at runtime, so a generator needs this.
//   declare-tools.ts     `defineTools()` — tools/list entry + validation rules
//                        from one declaration; `composite()` passes the
//                        hand-authored tools through untouched. Returns
//                        `{ tools, write }`, which is what defineToolCatalogue
//                        already takes: it composes, it does not replace.
export * from "./operation-index.js";
export * from "./declare-tools.js";

// ── bConnect v1.1 (a second API version, not a second transport) ─────────────
//
// v1.1 addresses `/bConnect/v1.1/<Controller>` with NO module segment, so it
// cannot go through the v2.0 client, whose transport asserts every request
// stays inside its module's `/<module>/v2.0/...` base path. The guard is
// untouched: `V11Client` takes a controller NAME, never a path, and refuses
// any method but GET, so it is structurally incapable of addressing a v2.0
// route. Read v11-client.ts's header before using it — it records why this is
// shared rather than copied per server, and what keeps that safe.
export * from "./v11-client.js";

// ── Result trust (M4) ────────────────────────────────────────────────────────
//
// The shared definition of "this answer may be incomplete", introduced when the
// truncation fixes needed one vocabulary instead of three. Through the barrel
// like everything else: a second import path for one module is exactly the kind
// of parallel thing that drifts here.
export * from "./result-trust.js";

// ── Id provenance (INT4-12) ──────────────────────────────────────────────────
//
// 147 of 218 tools take an opaque GUID and 127 said nothing about where to get
// it, while no description anywhere named another server - though 33 tools
// consume an id only a different server can produce. Applied centrally by
// defineToolCatalogue; read id-producers.ts before changing the table.
export * from "./id-producers.js";

// ── Estate strings are untrusted input (B5) ──────────────────────────────────
//
// The INBOUND boundary (model -> arguments) was well built; the OUTBOUND one
// (estate strings -> model context) had no controls at all. Read the module
// header for what this does and, more importantly, what it does not.
export * from "./untrusted-text.js";

// ── Cache provenance (H2) ────────────────────────────────────────────────────
//
// secure-disk-cache closes the cross-USER case. It does not close the
// cross-TENANT case: two MCP configs under one OS user, pointing at two bMS
// servers, resolved the same fixed path and read each other data. Read the
// module header before changing what goes into a fingerprint.
export * from "./cache-provenance.js";

// ── Server bootstrap (OPT-32) ────────────────────────────────────────────────
//
// One `runServer()` for the four behavioural main() variants. Read its header
// before adopting: every server changes behaviour in at least one respect, and
// the BCONNECT_BASE_URL default it removes was sending real credentials to
// bms.example.com whenever the variable was unset.
export * from "./run-server.js";

// ── Standalone HTTP transport: Host and Origin (ARCH-4) ──────────────────────
//
// `runServer`'s http branch mounts this; it is exported so the guard's rules can
// be tested directly and so a second HTTP surface has one implementation to
// adopt rather than a second copy to maintain.
export * from "./http-host-guard.js";
export * from "./job-state.js";
export * from "./date-age.js";
