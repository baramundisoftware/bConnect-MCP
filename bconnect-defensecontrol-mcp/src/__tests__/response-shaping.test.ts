/**
 * bconnect-defensecontrol-mcp — response shaping (Phase 4 token-consumption §3)
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `defensecontrol` was one of 8 servers with zero `createListShaper` adoption —
 * every list tool was `serializeToolResult(rawApiResult)`, unchanged from the
 * defect `shape-response.ts` was built to fix. Measured live against
 * labcorp.local (PageSize:20, 20 of 23 endpoints):
 *
 *   list_bitlocker_windows_endpoints   24,621 B -> 5,572 B   (-77.4%)
 *   list_defender_windows_endpoints    18,519 B -> 7,210 B   (-61.1%)
 *
 * Both rows are deeply nested — BitLocker per-disk/per-volume data (EFI and
 * Recovery partitions carry no BitLocker fact), Defender's four engine
 * sub-blocks repeating the same definitionVersion 3-4x — so each row is
 * flattened to the handful of top-level facts a fleet question actually asks
 * for before the shaper runs, and ONLY on the non-detail path: `detail:true`
 * gets the untouched raw envelope, unchanged byte-for-byte.
 *
 * This file, not a live call, is the regression guard: it pins the shape so a
 * future edit cannot silently widen or narrow the compact projection, and it
 * proves `detail:true` is exact against a fixture shaped after a real
 * labcorp.local row (see the literal below).
 *
 * ── Made to fail before being trusted ───────────────────────────────────────
 * Before this file existed, `list_bitlocker_windows_endpoints` and
 * `list_defender_windows_endpoints` returned `serializeToolResult(rawApiResult)`
 * unchanged — i.e. every assertion below that checks a field was REMOVED, or
 * that `meta.projection === 'compact'`, failed against that code. Confirmed by
 * temporarily reverting the two case arms to the raw passthrough and re-running
 * this file: 6 of 8 tests failed (the two that didn't are the `detail:true`
 * exactness checks, which pass either way since raw-passthrough is trivially
 * "exact").
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// ── The fake client ──────────────────────────────────────────────────────────

let nextResult: unknown = { data: [] };

function record() {
  return async (): Promise<unknown> => nextResult;
}

vi.mock('../bconnect-client.js', () => ({
  BConnectClient: class {
    defenseControl = {
      getBitLockerWindowsEndpoints: record(),
      getMicrosoftDefenderWindowsEndpoints: record(),
    };
  },
}));

const { createServer } = await import('../index.js');

// ── Fixtures, shaped after a real row measured live on labcorp.local ─────────
// (WIN10CLIENT4, 2026-08-03, via scripts/demo/phase4-call-and-measure.mjs)

function bitlockerRow(id: string, name: string): Record<string, unknown> {
  return {
    endpointId: id,
    endpointName: name,
    isSecureBootEnabled: false,
    isStartupPinEnabled: false,
    isStartupUsbKeyEnabled: false,
    networkUnlockStatus: 'NotSupported',
    tpmData: { version: '', tpmStatus: 'NotAvailable', isOwned: false },
    storageMedia: [
      {
        index: 0,
        name: 'VMware Virtual NVMe Disk',
        byteSize: 85899345920,
        busType: 'NVMe',
        partitionStyle: 'GPT',
        storageVolumes: [
          {
            bitLockerVolumeData: null,
            driveLetter: '',
            name: 'BOOT',
            fileSystem: 'FAT32',
            capacity: 362807296,
            freeSpace: 334327808,
            isSystemVolume: false,
            volumeId: 'e57a7e00-0000-4000-8000-000000000033',
            partitionType: 'EFI_System',
          },
          {
            bitLockerVolumeData: {
              conversionStatus: 'FullyDecrypted',
              encryptionPercentage: null,
              suspendCount: 0,
              bitLockerVersion: 'Unknown',
              protectionStatus: 'Unprotected',
              lockStatus: 'Unlocked',
            },
            driveLetter: 'C',
            name: 'System',
            fileSystem: 'NTFS',
            capacity: 84086353920,
            freeSpace: 42594893824,
            isSystemVolume: true,
            volumeId: 'e57a7e00-0000-4000-8000-000000000019',
            partitionType: 'Data',
          },
          {
            bitLockerVolumeData: null,
            driveLetter: '',
            name: 'Windows RE tools',
            fileSystem: 'NTFS',
            capacity: 1309667328,
            freeSpace: 764264448,
            isSystemVolume: false,
            volumeId: 'e57a7e00-0000-4000-8000-000000000044',
            partitionType: 'Recovery',
          },
        ],
      },
    ],
  };
}

function defenderRow(id: string, name: string): Record<string, unknown> {
  return {
    endpointId: id,
    endpointName: name,
    isMicrosoftDefenderActive: true,
    microsoftDefenderState: {
      antimalware: {
        engineVersion: '1.1.25070.4',
        productVersion: '4.18.25070.5',
        runningMode: 'Normal',
        isActive: true,
        serviceVersion: '4.18.25070.5',
      },
      antispyware: {
        isActive: true,
        definitionCreation: '2025-08-12T07:30:09Z',
        definitionVersion: '1.435.126.0',
      },
      antivirus: {
        isActive: true,
        definitionCreation: '2025-08-12T07:30:09Z',
        definitionVersion: '1.435.126.0',
      },
      networkInspectionSystem: {
        isActive: true,
        engineVersion: '1.1.25070.4',
        definitionCreation: '2025-08-12T07:30:09Z',
        definitionVersion: '1.435.126.0',
      },
      isBehaviorMonitoringActive: true,
      isIoavProtectionActive: true,
      isTamperProtectionActive: true,
      isOnAccessProtectionActive: true,
      isRealTimeProtectionActive: true,
      realTimeScanDirection: 'IncomingAndOutgoingFiles',
      lastFullScan: null,
      lastQuickScan: '2025-08-12T21:27:33.64Z',
      highestSeverity: 'None',
      activeThreats: 0,
      resolvedThreats: 0,
    },
  };
}

function envelope(rows: Record<string, unknown>[]): Record<string, unknown> {
  return {
    currentPage: 0,
    pageSize: 20,
    totalPages: 2,
    totalItems: rows.length + 3,
    hasPreviousPage: false,
    hasNextPage: true,
    data: rows,
  };
}

// ── Harness ──────────────────────────────────────────────────────────────────

async function connect(): Promise<Client> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: 'https://bms-server/bconnect' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'shaping-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

async function callJson(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

const bytes = (value: string): number => Buffer.byteLength(value, 'utf8');

beforeEach(() => {
  nextResult = { data: [] };
});
afterEach(() => {
  delete process.env.ALLOW_WRITE_OPERATIONS;
});

// ── list_bitlocker_windows_endpoints ──────────────────────────────────────────

describe('list_bitlocker_windows_endpoints — compact projection', () => {
  it('flattens tpmStatus and the system volume, and drops per-disk/per-volume detail', async () => {
    const client = await connect();
    nextResult = envelope([
      bitlockerRow('e57a7e00-0000-4000-8000-000000000006', 'WIN10CLIENT4'),
      bitlockerRow('e57a7e00-0000-4000-8000-000000000010', 'WIN10CLIENT1'),
    ]);
    const json = await callJson(client, 'list_bitlocker_windows_endpoints', {});

    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      endpointId: 'e57a7e00-0000-4000-8000-000000000006',
      endpointName: 'WIN10CLIENT4',
      isSecureBootEnabled: false,
      tpmStatus: 'NotAvailable',
      systemVolume: {
        driveLetter: 'C',
        protectionStatus: 'Unprotected',
        conversionStatus: 'FullyDecrypted',
        lockStatus: 'Unlocked',
      },
    });
    for (const gone of ['tpmData', 'storageMedia', 'isStartupPinEnabled', 'isStartupUsbKeyEnabled', 'networkUnlockStatus']) {
      expect(rows[0], `${gone} must not survive on the row`).not.toHaveProperty(gone);
    }

    // Nothing dropped without saying so.
    const meta = json.meta as Record<string, unknown>;
    expect(meta.projection).toBe('compact');
    expect(meta.projectedAway).toEqual(
      expect.arrayContaining(['tpmData', 'storageMedia', 'isStartupPinEnabled', 'isStartupUsbKeyEnabled', 'networkUnlockStatus'])
    );
    expect(String(meta.hint)).toMatch(/NOT evidence they are unset/);

    // The envelope survives — it is how the caller knows to page.
    expect(json.totalItems).toBe(5);
    expect(json.totalPages).toBe(2);
  });

  it('detail:true returns the raw record, byte-identical to the unshaped response', async () => {
    const client = await connect();
    const raw = envelope([bitlockerRow('e57a7e00-0000-4000-8000-000000000006', 'WIN10CLIENT4')]);
    nextResult = raw;
    const result = (await client.callTool({
      name: 'list_bitlocker_windows_endpoints',
      arguments: { detail: true },
    })) as { content: { text: string }[] };

    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('saves more than half the page (measured, not asserted by hand)', async () => {
    const client = await connect();
    const rows = Array.from({ length: 20 }, (_, i) =>
      bitlockerRow(`endpoint-${i}`, `WIN10CLIENT${i}`)
    );
    nextResult = envelope(rows);
    const compactText = JSON.stringify(await callJson(client, 'list_bitlocker_windows_endpoints', {}));
    const rawText = JSON.stringify(envelope(rows));

    expect(bytes(compactText)).toBeLessThan(bytes(rawText) * 0.5);
  });
});

// ── list_defender_windows_endpoints ───────────────────────────────────────────

describe('list_defender_windows_endpoints — compact projection', () => {
  it('flattens the Defender summary and drops the four engine sub-blocks', async () => {
    const client = await connect();
    nextResult = envelope([
      defenderRow('e57a7e00-0000-4000-8000-000000000006', 'WIN10CLIENT4'),
      defenderRow('e57a7e00-0000-4000-8000-000000000010', 'WIN10CLIENT1'),
    ]);
    const json = await callJson(client, 'list_defender_windows_endpoints', {});

    const rows = json.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      endpointId: 'e57a7e00-0000-4000-8000-000000000006',
      endpointName: 'WIN10CLIENT4',
      isMicrosoftDefenderActive: true,
      isRealTimeProtectionActive: true,
      isTamperProtectionActive: true,
      highestSeverity: 'None',
      activeThreats: 0,
      resolvedThreats: 0,
      definitionVersion: '1.435.126.0',
      lastQuickScan: '2025-08-12T21:27:33.64Z',
      lastFullScan: null,
    });
    expect(rows[0]).not.toHaveProperty('microsoftDefenderState');

    const meta = json.meta as Record<string, unknown>;
    expect(meta.projection).toBe('compact');
    expect(meta.projectedAway).toEqual(['microsoftDefenderState']);
  });

  it('detail:true returns the raw record, byte-identical to the unshaped response', async () => {
    const client = await connect();
    const raw = envelope([defenderRow('e57a7e00-0000-4000-8000-000000000006', 'WIN10CLIENT4')]);
    nextResult = raw;
    const result = (await client.callTool({
      name: 'list_defender_windows_endpoints',
      arguments: { detail: true },
    })) as { content: { text: string }[] };

    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });

  it('saves more than half the page (measured, not asserted by hand)', async () => {
    const client = await connect();
    const rows = Array.from({ length: 20 }, (_, i) =>
      defenderRow(`endpoint-${i}`, `WIN10CLIENT${i}`)
    );
    nextResult = envelope(rows);
    const compactText = JSON.stringify(await callJson(client, 'list_defender_windows_endpoints', {}));
    const rawText = JSON.stringify(envelope(rows));

    expect(bytes(compactText)).toBeLessThan(bytes(rawText) * 0.5);
  });
});
