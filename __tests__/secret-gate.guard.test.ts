/**
 * Secret-gate guard (REQ-SRV-017, ADR-0004).
 *
 * Every tool of every server is called, for both bMS releases, with arguments
 * generated from its input schema. MSW records the HTTP requests the tools send.
 *
 * Pass A (writes on, ALLOW_SECRET_READ unset):
 *   no request may reach an operation whose response carries a secret, as derived
 *   from the OpenAPI specs (see lib/spec-secrets.ts). Every tool must be
 *   exercised: it either sent a request or was refused by the secret gate.
 * Pass B (all gates open):
 *   every request must go to an operation that exists in the spec. A tool whose
 *   path drifted from the spec is broken against a real bMS, and the secret check
 *   in pass A cannot see it.
 *
 * The expectations come from the spec and the behaviour from the traffic, so a
 * hand-maintained list can't make this pass on its own.
 * Exceptions live in the allow-lists below, each with a reason; an entry that no
 * longer occurs fails the test, so the lists can't go stale.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  RELEASES, type Release, findOperation, loadOperations, secretBearingOperations,
} from './lib/spec-secrets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'http://bms.guard.test/bconnect';
const BASE_PATH = new URL(BASE_URL).pathname;
const ID = '00000000-0000-4000-8000-000000000001';

/** Tools allowed to reach a secret-bearing operation with ALLOW_SECRET_READ unset. */
const SECRET_ALLOW: Record<string, string> = {
  start_android_enrollment: 'deferred: enrollment-token classification pending (separate issue)',
  start_ios_enrollment: 'deferred: enrollment-token classification pending (separate issue)',
  start_mac_enrollment: 'deferred: enrollment-token classification pending (separate issue)',
};

/**
 * Requests to paths that are not in the spec, known on 2026-09-30 (ratchet).
 * Pre-existing drift, not triaged yet; new entries must not be added to hide a bug.
 */
const DRIFT = 'pre-existing, untriaged path drift (2026-09-30)';
const UNKNOWN_PATH_ALLOW: Record<string, string> = Object.fromEntries([
  '25R2 list_detected_rule_violations GET /compliance/v2.0/DetectedRuleViolations',
  '25R2 list_detected_rule_violations_for_endpoint GET /compliance/v2.0/Endpoints/{id}/DetectedRuleViolations',
  '25R2 list_detected_vulnerabilities GET /compliance/v2.0/DetectedVulnerabilities',
  '25R2 list_detected_vulnerabilities_for_endpoint GET /compliance/v2.0/WindowsEndpoints/{id}/DetectedVulnerabilities',
  '25R2 list_mobile_device_rules GET /compliance/v2.0/MobileDeviceRules',
  '25R2 get_mobile_device_rule GET /compliance/v2.0/MobileDeviceRules/{id}',
  '25R2 list_vulnerabilities GET /compliance/v2.0/Vulnerabilities',
  '25R2 get_vulnerability GET /compliance/v2.0/Vulnerabilities/{id}',
  '25R2 update_maintenance_window_for_endpoint PATCH /endpoints/v2.0/Endpoints/{id}/MaintenanceWindow',
  '25R2 update_maintenance_window_for_logical_group PATCH /endpoints/v2.0/LogicalGroups/{id}/MaintenanceWindow',
  '26R1 list_mobile_device_rules GET /compliance/v2.0/MobileDeviceRules',
  '26R1 get_mobile_device_rule GET /compliance/v2.0/MobileDeviceRules/{id}',
  '26R1 list_industrial_endpoints GET /endpoints/v2.0/IndustrialEndpoints',
  '26R1 get_industrial_endpoint GET /endpoints/v2.0/IndustrialEndpoints/{id}',
  '26R1 create_industrial_endpoint POST /endpoints/v2.0/IndustrialEndpoints',
  '26R1 update_industrial_endpoint PATCH /endpoints/v2.0/IndustrialEndpoints/{id}',
  '26R1 delete_industrial_endpoint DELETE /endpoints/v2.0/IndustrialEndpoints/{id}',
  '26R1 get_entra_id_data GET /endpoints/v2.0/Endpoints/{id}/EntraIdData',
  '26R1 list_industrial_endpoints_by_logical_group GET /endpoints/v2.0/LogicalGroups/{id}/IndustrialEndpoints',
  '26R1 list_industrial_endpoints_by_static_group GET /endpoints/v2.0/StaticGroups/{id}/IndustrialEndpoints',
  '26R1 list_industrial_endpoints_by_universal_dynamic_group GET /endpoints/v2.0/UniversalDynamicGroups/{id}/IndustrialEndpoints',
].map((k) => [k, DRIFT]));

interface Call {
  release: Release;
  server: string;
  tool: string;
  requests: Array<{ method: string; path: string }>;
  refusedBySecretGate: boolean;
}

type JsonSchema = Record<string, any>;

/** A value that passes the servers' argument validation for the given property. */
function sample(name: string, schema: JsonSchema): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  switch (schema.type) {
    case 'string': return /id$/i.test(name) ? ID : 'x';
    case 'integer':
    case 'number': return 1;
    case 'boolean': return false;
    case 'array': return /patch|operations/i.test(name) ? [{ op: 'replace', path: '/name', value: 'x' }] : [];
    case 'object': return { name: 'x' };
    default: return 'x';
  }
}

function argumentsFor(inputSchema: JsonSchema): Record<string, unknown> {
  const required: string[] = inputSchema.required ?? [];
  const args: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries<JsonSchema>(inputSchema.properties ?? {})) {
    if (required.includes(name)) args[name] = sample(name, schema);
  }
  return args;
}

const SERVERS = readdirSync(ROOT).filter((d) => /^bconnect-.+-mcp$/.test(d)).sort();

let recorded: Array<{ method: string; path: string }> = [];
const msw = setupServer(
  http.all('*', ({ request }) => {
    recorded.push({ method: request.method, path: new URL(request.url).pathname });
    return HttpResponse.json({});
  }),
);

const savedEnv = { ...process.env };

/** Call every tool of every server once, for one release and one gate setting. */
async function exerciseAll(release: Release, secretRead: boolean): Promise<Call[]> {
  Object.assign(process.env, {
    BCONNECT_BASE_URL: BASE_URL,
    BCONNECT_USERNAME: 'guard',
    BCONNECT_PASSWORD: 'guard',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true',
    BCONNECT_RELEASE: release,
    ALLOW_WRITE_OPERATIONS: 'true',
    // Empty, not deleted: dotenv never overrides a key that is present.
    ALLOW_SECRET_READ: secretRead ? 'true' : '',
  });
  const calls: Call[] = [];
  for (const server of SERVERS) {
    const mod = await import(pathToFileURL(join(ROOT, server, 'src', 'index.ts')).href);
    const { server: mcp } = mod.createServer();
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'secret-gate-guard', version: '0' });
    await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
    for (const tool of (await client.listTools()).tools) {
      recorded = [];
      let text = '';
      try {
        const result = await client.callTool({ name: tool.name, arguments: argumentsFor(tool.inputSchema) });
        text = JSON.stringify(result.content ?? '');
      } catch (error) {
        text = String((error as Error).message);
      }
      calls.push({
        release, server, tool: tool.name,
        requests: recorded.map((r) => ({ method: r.method, path: r.path.slice(BASE_PATH.length) })),
        refusedBySecretGate: recorded.length === 0 && /ALLOW_SECRET_READ/.test(text),
      });
    }
    await client.close();
  }
  return calls;
}

const template = (path: string) => path.split(ID).join('{id}');

beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
afterAll(() => {
  msw.close();
  process.env = savedEnv;
});

describe('secret derivation from the OpenAPI specs (self-check)', () => {
  const key = (r: Release) => secretBearingOperations(r).map((o) => `${o.method} ${o.path}`);

  it('finds the BitLocker secrets (26R1) and LAPS credentials (both releases)', () => {
    expect(key('26R1')).toEqual(expect.arrayContaining([
      'GET /v2.0/BitLocker/WindowsEndpoints/{id}/Secrets',
      'PATCH /v2.0/BitLocker/WindowsEndpoints/{id}/Secrets',
      'GET /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}',
      'PATCH /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}',
    ]));
    expect(key('25R2')).toEqual(expect.arrayContaining([
      'GET /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}',
      'PATCH /v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}',
    ]));
  });

  it('matches camelCase names and ignores non-string status flags', () => {
    const secrets = secretBearingOperations('26R1').find((o) => o.path.endsWith('/{id}/Secrets'));
    expect(secrets?.secretFields).toContain('BitLockerSecrets.initialStartupPin');
    const state = loadOperations('26R1').find((o) => o.method === 'GET' && o.path === '/v2.0/BitLocker/WindowsEndpoints/{id}');
    expect(state).toBeDefined();
    expect(state!.secretFields).toEqual([]); // isStartupPinEnabled is a boolean
  });
});

describe.each(RELEASES)('secret gate, bMS %s', (release) => {
  let closed: Call[];
  let open: Call[];

  beforeAll(async () => {
    closed = await exerciseAll(release, false);
    open = await exerciseAll(release, true);
  }, 120_000);

  it('exercises every tool (no silent gaps)', () => {
    const idle = closed.filter((c) => c.requests.length === 0 && !c.refusedBySecretGate);
    expect(idle.map((c) => `${c.server}:${c.tool}`)).toEqual([]);
  });

  it('never reaches a secret-bearing operation with ALLOW_SECRET_READ unset', () => {
    const leaks: string[] = [];
    for (const call of closed) {
      if (SECRET_ALLOW[call.tool]) continue;
      for (const r of call.requests) {
        const op = findOperation(release, r.method, r.path);
        if (op && op.secretFields.length) {
          leaks.push(`${call.tool} → ${r.method} ${template(r.path)} returns ${op.secretFields.join(', ')}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('sends every request to an operation that exists in the spec', () => {
    const unknown = new Set<string>();
    for (const call of open) {
      for (const r of call.requests) {
        if (!findOperation(release, r.method, r.path)) unknown.add(`${release} ${call.tool} ${r.method} ${template(r.path)}`);
      }
    }
    const notAllowed = [...unknown].filter((k) => !UNKNOWN_PATH_ALLOW[k]);
    expect(notAllowed).toEqual([]);
    // Ratchet: an allow-list entry that no longer happens must be removed.
    const stale = Object.keys(UNKNOWN_PATH_ALLOW).filter((k) => k.startsWith(release + ' ') && !unknown.has(k));
    expect(stale).toEqual([]);
  });

  it('keeps every secret allow-list entry in use', () => {
    const used = new Set(
      closed.filter((c) => c.requests.some((r) => findOperation(release, r.method, r.path)?.secretFields.length))
        .map((c) => c.tool),
    );
    expect(Object.keys(SECRET_ALLOW).filter((t) => !used.has(t))).toEqual([]);
  });
});
