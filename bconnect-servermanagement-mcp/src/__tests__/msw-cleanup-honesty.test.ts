/**
 * The MSW cleanup pair surfaces what the API answered.
 *
 * ── Why this exists (TOOL-REVIEW-MATRIX.md, findings H5 and the msw_cleanup
 * MED) ──────────────────────────────────────────────────────────────────────
 * simulate_msw_cleanup's own description commands "the 200 body is NOT a
 * boolean: it returns the list of files that WOULD be deleted — read the
 * response", while the module discarded the body (`Promise<void>`) and the
 * handler returned the constant "MSW cleanup simulation completed." — a
 * dry-run whose only product was thrown away. msw_cleanup was worse in kind:
 * the 200 body carries `wasSuccessful: boolean`, and the constant handler
 * text asserted success unconditionally, so a failed cleanup was reported as
 * done. Same defect class as the installer's verify-exit-0.
 *
 * Driven through the REAL handler over InMemoryTransport with the API
 * mocked, per the project rule that only the handler path proves what a
 * model sees.
 *
 * Falsified: all three fail against the pre-fix constant-string arms, and
 * were watched failing before the fix was trusted.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../index.js';

const BASE_URL = 'http://bms.test.local/bconnect';
const DIPS = `${BASE_URL}/servermanagement/v2.0/Dips`;

const mockApi = setupServer();

let savedGate: string | undefined;
beforeAll(() => {
  savedGate = process.env.ALLOW_WRITE_OPERATIONS;
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
  mockApi.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => {
  process.env.ALLOW_WRITE_OPERATIONS = savedGate ?? '';
  mockApi.close();
});
afterEach(() => mockApi.resetHandlers());

async function callText(name: string): Promise<{ text: string; isError?: boolean }> {
  const { server } = createServer({ apiKey: 'test-key', baseUrl: BASE_URL });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'msw-cleanup-probe', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  const result = await client.callTool({ name, arguments: {} });
  return {
    text: (result.content as Array<{ text: string }>)[0].text,
    isError: result.isError as boolean | undefined,
  };
}

describe('simulate_msw_cleanup returns the list its description promises', () => {
  it('surfaces every file the simulation would delete', async () => {
    mockApi.use(
      http.post(`${DIPS}/SimulateMSWCleanup`, () =>
        HttpResponse.json({
          simulationResult: '2 files would be deleted',
          filesToDelete: ['obsolete-package-a.msw', 'obsolete-package-b.msw'],
        })
      )
    );
    const { text, isError } = await callText('simulate_msw_cleanup');
    expect(isError).toBeFalsy();
    // The dry-run's product must reach the model — pre-fix this text was the
    // constant "MSW cleanup simulation completed." and both names are absent.
    expect(text).toContain('obsolete-package-a.msw');
    expect(text).toContain('obsolete-package-b.msw');
  });
});

describe('msw_cleanup surfaces wasSuccessful instead of asserting success', () => {
  it('a wasSuccessful:false answer is not reported as a completed cleanup', async () => {
    mockApi.use(
      http.post(`${DIPS}/MSWCleanup`, () =>
        HttpResponse.json({ wasSuccessful: false, result: 'disk full on master DIP' })
      )
    );
    const { text } = await callText('msw_cleanup');
    // The discriminating pair: the API's own outcome fields must be visible…
    expect(text).toContain('disk full on master DIP');
    expect(text).toMatch(/false/);
    // …and the pre-fix constant must be gone, because it asserts the one
    // thing this response denies.
    expect(text).not.toBe('MSW cleanup executed.');
  });

  it('a wasSuccessful:true answer carries the result text through', async () => {
    mockApi.use(
      http.post(`${DIPS}/MSWCleanup`, () =>
        HttpResponse.json({ wasSuccessful: true, result: 'Removed 3 obsolete packages' })
      )
    );
    const { text, isError } = await callText('msw_cleanup');
    expect(isError).toBeFalsy();
    expect(text).toContain('Removed 3 obsolete packages');
  });
});
