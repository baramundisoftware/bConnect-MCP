#!/usr/bin/env node
/**
 * An in-repo bConnect mock, with fault injection.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Thirteen servers ship a "mock-integration tier" (51 tests) that talks to
 * `bConnect-Mock`, an EXTERNAL service on port 13433. That service is not in
 * this repository and is not on this machine, so the tier had never executed
 * here — measured 2026-08-22, and the measurement is the point:
 *
 *     Test Files  1 passed (1)
 *          Tests  4 skipped (4)
 *     EXIT=0
 *
 * A file reported PASSED having made zero assertions, and the runner exited 0.
 * `docs/MOCK_INTEGRATION_TESTING.md` described that as a feature — "the run
 * reports passing — never failing — so this tier is safe to invoke in CI" —
 * which is the same shape as `test-catalog-drift` reporting "0 passed, 0
 * failed, 14 skipped" and exiting 0. A tier that cannot fail is decorative.
 *
 * So the dependency is removed rather than documented: this file is a mock the
 * repository owns, with no dependencies beyond `node:http`.
 *
 * ── What it is NOT ──────────────────────────────────────────────────────────
 * It is not a reimplementation of bConnect and must never be mistaken for one.
 * It answers the SHAPE of the API — the paged envelope, id round-trip, 404 on
 * a nonexistent id — because that is what the tier asserts (measured: the whole
 * tier asserts six distinct row fields). It knows nothing about real bMS
 * semantics, and a test that needs those still needs a real bMS or the vendor's
 * mock.
 *
 * ── The half that is actually new: faults ───────────────────────────────────
 * The least-exercised code in this suite is what happens when bMS is slow,
 * down, or fails MID-WALK. `msw` covers status codes at the fetch layer, but it
 * cannot produce a dropped socket, a body that stops arriving, or a server that
 * accepts a connection and never answers — and those are the cases a composite
 * walking 55 pages actually meets. This mock is a real socket, so it can.
 *
 *   POST /api/fault  {"mode":"status-500","after":2,"count":1}
 *
 * `after` is what makes MID-WALK testable: N requests succeed, then the fault
 * applies to the next `count` of them. `POST /api/reset` clears everything.
 *
 * Modes, each chosen because this project has actually been bitten by it:
 *   status-401|403|429|500|503   the ordinary failures
 *   slow                          delayMs before responding (timeout paths)
 *   hang                          accept and never answer (the worst case)
 *   drop                          destroy the socket mid-request
 *   empty-page                    200, data:[], totalItems intact  <- observed LIVE
 *   string-total                  totalItems: "27" (present but unreadable)
 *   bad-total-pages               totalPages: "many" (the paginateAll poison)
 *   not-envelope                  200 with a body that is not the envelope
 *
 * Usage:
 *   node scripts/bconnect-mock.mjs [--port 13433] [--quiet]
 */
import { createServer } from "node:http";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const PORT = Number(argOf("--port", process.env.BCONNECT_MOCK_PORT ?? 13433));
const QUIET = args.includes("--quiet");

/** The GUID the tier's helpers export as "this does not exist". */
const NONEXISTENT_GUID = "00000000-0000-0000-0000-000000000000";

/**
 * The bMS version served at the version-probe route.
 *
 * Deliberately NOT this lab's build number. The gate parses the dotted form as
 * (major, release), so 26.1 satisfies the 26R1 minimum without implying the
 * mock is standing in for a particular estate's server.
 */
const MOCK_BMS_VERSION = "26.1.0.0";

// ── Fault state ─────────────────────────────────────────────────────────────

let fault = null;
let requestsSinceFaultSet = 0;

function setFault(spec) {
  fault = spec && spec.mode ? {
    mode: String(spec.mode),
    after: Number.isFinite(Number(spec.after)) ? Number(spec.after) : 0,
    count: Number.isFinite(Number(spec.count)) ? Number(spec.count) : Infinity,
    delayMs: Number.isFinite(Number(spec.delayMs)) ? Number(spec.delayMs) : 2000,
    applied: 0,
  } : null;
  requestsSinceFaultSet = 0;
}

/** Does the fault apply to THIS request? Consumes one of its `count` if so. */
function faultForThisRequest() {
  if (!fault) { return null; }
  if (requestsSinceFaultSet < fault.after) { requestsSinceFaultSet++; return null; }
  if (fault.applied >= fault.count) { return null; }
  fault.applied++;
  return fault;
}

// ── Deterministic synthetic rows ────────────────────────────────────────────

/** 8 hex chars derived from a name, so a collection's ids are stable per run. */
function hexPrefix(name) {
  let h = 0x811c9dc5;
  for (const ch of name) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 8);
}

function guidFor(collection, index) {
  const p = hexPrefix(collection);
  const tail = String(index + 1).padStart(12, "0");
  return p + "-0001-0001-0001-" + tail;
}

/**
 * One row.
 *
 * It carries every identity alias the tier reads — `id`, `endpointId`,
 * `assetId` — all set to the same value, plus the name fields it asserts on.
 * That is a deliberate simplification and the reason this mock is not a
 * substitute for the real API: a real row carries ONE identity, and code that
 * picks the wrong one would pass here and fail against bMS. Route-shape bugs
 * are what this tier is for; identity-selection bugs are not.
 */
function rowFor(collection, index, tenant = "") {
  const id = guidFor(collection, index);
  const n = index + 1;
  const row = {
    id,
    endpointId: id,
    assetId: id,
    name: "MOCK-" + collection + "-" + n,
    displayName: "MOCK-" + collection + "-" + n,
    // Deliberately NOT varied by tenant. A display name that collides across
    // estates is the whole reason cache-provenance exists — scan-recency keys
    // its history by this field, and "WIN10-01" exists on most estates. Two
    // tenants must produce the SAME name and DIFFERENT data.
    endpointName: "MOCK-ENDPOINT-" + n,
    hostName: "MOCK-ENDPOINT-" + n,
    endpointType: "WindowsEndpoint",
    comment: null,
  };

  // Job instances carry the step shape the scan-recency reduction reads. Without
  // it the mock returns rows that no composite can index, which is how a probe
  // came to assert "no cross-tenant crossover" over two EMPTY sets — a vacuous
  // pass, recorded in that probe rather than quietly fixed.
  if (/JobInstances$/.test(collection)) {
    // The scan date is a function of the tenant, so the same endpoint name on
    // two tenants carries two different dates and a crossover is visible.
    const day = 1 + (parseInt(hexPrefix(tenant || "default").slice(0, 4), 16) % 27);
    const stamp = "2026-08-" + String(day).padStart(2, "0") + "T00:00:00Z";
    row.jobDefinitionName = "SCAN: Weekly Security Scan";
    row.state = "FinishedSuccessfully";
    row.lastAction = stamp;
    row.successfulExecutions = 3;
    row.erroneousExecutions = 0;
    row.steps = [
      { type: "WindowsComplianceScan", state: "FinishedSuccessfully", lastAction: stamp },
    ];
  }
  return row;
}

function envelope(collection, pageSize, page, total, tenant = "") {
  const rows = [];
  const start = page * pageSize;
  for (let i = start; i < Math.min(start + pageSize, total); i++) {
    rows.push(rowFor(collection, i, tenant));
  }
  return {
    currentPage: page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    totalItems: total,
    hasPreviousPage: page > 0,
    hasNextPage: start + rows.length < total,
    data: rows,
  };
}

// ── Server ──────────────────────────────────────────────────────────────────

const DEFAULT_TOTAL = 7;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  // ── Control plane. Never faulted: a test must always be able to clear a
  //    fault it set, or one failure poisons the rest of the file.
  if (path === "/health") {
    return json(res, 200, {
      status: "ok",
      profile: "in-repo-generic",
      bmsVersion: MOCK_BMS_VERSION,
      fault: fault ? fault.mode : null,
    });
  }
  if (path === "/api/reset" && req.method === "POST") {
    setFault(null);
    return json(res, 200, { status: "reset" });
  }
  if (path === "/api/fault" && req.method === "POST") {
    const body = await readBody(req);
    setFault(body);
    return json(res, 200, { status: "ok", fault });
  }

  // ── Faults apply to the API surface only ────────────────────────────────
  const f = faultForThisRequest();
  if (f) {
    switch (f.mode) {
      case "status-401": return json(res, 401, { error: "Unauthorized (mock fault)" });
      case "status-403": return json(res, 403, { error: "Forbidden (mock fault)" });
      case "status-429": return json(res, 429, { error: "Too Many Requests (mock fault)" });
      case "status-500": return json(res, 500, { error: "Internal Server Error (mock fault)" });
      case "status-503": return json(res, 503, { error: "Service Unavailable (mock fault)" });
      case "hang": return; // accept, never answer
      case "drop": return req.socket.destroy();
      case "slow": await new Promise((r) => setTimeout(r, f.delayMs)); break;
      case "empty-page":
        return json(res, 200, {
          currentPage: 0, pageSize: 100, totalPages: 3, totalItems: 27,
          hasPreviousPage: false, hasNextPage: true, data: [],
        });
      case "string-total":
        return json(res, 200, {
          currentPage: 0, pageSize: 100, totalPages: 1, totalItems: "27",
          hasPreviousPage: false, hasNextPage: false, data: [rowFor("faulted", 0)],
        });
      case "bad-total-pages":
        return json(res, 200, {
          currentPage: 0, pageSize: 100, totalPages: "many", totalItems: 27,
          hasPreviousPage: false, hasNextPage: true, data: [rowFor("faulted", 0)],
        });
      case "not-envelope":
        return json(res, 200, { message: "maintenance in progress" });
      default: break;
    }
  }

  // ── The version probe the startup gate reads ────────────────────────────
  if (path === "/servermanagement/v2.0/ManagementServer") {
    return json(res, 200, {
      version: MOCK_BMS_VERSION,
      name: "MOCK-BMS",
      id: guidFor("ManagementServer", 0),
    });
  }

  // ── /{module}/v2.0/{Collection}[/{id}[/{SubCollection}]] ────────────────
  const parts = path.split("/").filter(Boolean);
  const vIndex = parts.findIndex((p) => /^v\d+\.\d+$/.test(p));
  if (vIndex === -1 || parts.length < vIndex + 2) {
    return json(res, 404, { error: "No such route in the mock: " + path });
  }

  const afterVersion = parts.slice(vIndex + 1);
  // Everything before the module/version marker is a tenant prefix. It lets one
  // mock stand in for two bMS servers on one port, which is what a cross-tenant
  // test needs.
  const tenant = parts.slice(0, Math.max(0, vIndex - 1)).join("/");
  const idAt = afterVersion.findIndex((p) => /^[0-9a-fA-F-]{36}$/.test(p));

  // A nonexistent id 404s wherever it appears — the tier's 404 assertion.
  if (afterVersion.some((p) => p.toLowerCase() === NONEXISTENT_GUID)) {
    return json(res, 404, { error: "Not found (mock): no object with that id" });
  }

  const pageSize = Math.min(Number(url.searchParams.get("PageSize") ?? 20) || 20, 1000);
  const page = Number(url.searchParams.get("Page") ?? 0) || 0;

  // .../{Collection}/{id}/{SubCollection}  -> a paged sub-resource
  if (idAt !== -1 && afterVersion.length > idAt + 1) {
    const sub = afterVersion.slice(idAt + 1).join("/");
    return json(res, 200, envelope(sub, pageSize, page, DEFAULT_TOTAL, tenant));
  }

  // .../{Collection}/{id}  -> one object, echoing the id it was asked for
  if (idAt !== -1) {
    const collection = afterVersion.slice(0, idAt).join("/");
    const row = rowFor(collection, 0);
    const id = afterVersion[idAt];
    return json(res, 200, { ...row, id, endpointId: id, assetId: id });
  }

  // .../{Collection}  -> a page
  const collection = afterVersion.join("/");
  return json(res, 200, envelope(collection, pageSize, page, DEFAULT_TOTAL, tenant));
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (!res.headersSent) { json(res, 500, { error: String(err) }); }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  if (!QUIET) {
    console.log("bconnect-mock listening on http://127.0.0.1:" + PORT);
    console.log("  health: GET /health   faults: POST /api/fault   clear: POST /api/reset");
  }
  if (process.send) { process.send({ ready: true, port: PORT }); }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { server.close(() => process.exit(0)); });
}
