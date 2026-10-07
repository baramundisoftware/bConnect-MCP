/**
 * ServerManagement — mock integration tests.
 * See docs/MOCK_INTEGRATION_TESTING.md.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { detectRelease, forgetDetectedRelease } from '@bconnect/mcp-core';
import { BConnectClient } from '../../bconnect-client.js';
import {
  checkMockAvailable,
  createClient,
  getMockHealth,
  MOCK_BASE_URL,
  NONEXISTENT_GUID,
} from './helpers.js';

let available = false;
let client: BConnectClient;

beforeAll(async () => {
  available = await checkMockAvailable();
  if (!available) {
    console.warn(`⚠  bConnectMock not reachable at ${MOCK_BASE_URL} — servermanagement mock tests skipped`);
    return;
  }
  client = createClient();
});

describe('release detection (#159, needs bConnect-Mock 0.5.0 or later)', () => {
  it('selects the release the mock serves, from ManagementServer.version', async () => {
    if (!available) {return;}
    const health = await getMockHealth();
    const expected = health!.bmsVersion.toUpperCase();
    // bConnect-Mock before 0.5.0 answers this fixed version for every release: nothing to check there.
    if (await client.managementServerVersion() === '26.1.0.5678') {
      console.warn('⚠  bConnectMock older than 0.5.0 — release detection test skipped');
      return;
    }
    const lines: string[] = [];
    try {
      const release = await detectRelease(client, { info: (l) => lines.push(l), warn: (l) => lines.push(`warn ${l}`) }, {});
      expect(lines, lines.join('\n')).toHaveLength(1);
      expect(lines[0]).toMatch(new RegExp(`^bMS \\d+\\.\\d+[.\\d]* → release ${expected}$`));
      expect(release).toBe(expected);
    } finally {
      forgetDetectedRelease();
    }
  });
});

describe('ServerManagement — list SecurityGroups', () => {
  it('returns paged data with totalItems', async () => {
    if (!available) {return;}
    const result = await client.serverManagement.getSecurityGroups({ PageSize: 10 } as never);
    expect(Array.isArray(result.data)).toBe(true);
    expect(typeof result.totalItems).toBe('number');
    expect(result.data!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ServerManagement — get SecurityGroup by id', () => {
  it('returns the same group surfaced by the list', async () => {
    if (!available) {return;}
    const list = await client.serverManagement.getSecurityGroups({ PageSize: 1 } as never);
    const id = list.data?.[0]?.id;
    if (!id) {throw new Error('mock returned empty SecurityGroups list');}
    const item = await client.serverManagement.getSecurityGroup(id);
    expect(item.id).toBe(id);
  });
});

describe('ServerManagement — get ManagementServer (singleton)', () => {
  it('returns the management-server payload', async () => {
    if (!available) {return;}
    const ms = await client.serverManagement.getManagementServer();
    expect(ms).toBeDefined();
  });
});

describe('ServerManagement — unknown SecurityGroup id', () => {
  it('rejects on get with nonexistent GUID', async () => {
    if (!available) {return;}
    await expect(client.serverManagement.getSecurityGroup(NONEXISTENT_GUID)).rejects.toThrow();
  });
});
