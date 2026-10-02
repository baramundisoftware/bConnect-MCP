/**
 * PATCH requests carry the content type bConnect declares (#188).
 *
 * Every PATCH operation in the bundled 25R2 and 26R1 specs declares only
 * application/json-patch+json, so the shared client sends that type for every
 * PATCH, whichever module builds it. Other methods keep application/json.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { BConnectClientBase } from '../packages/mcp-core/src/bconnect-client-base.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ID = '00000000-0000-4000-8000-000000000001';

let seen: Array<{ method: string; contentType: string | null }> = [];
const msw = setupServer(http.all('*', ({ request }) => {
  seen.push({ method: request.method, contentType: request.headers.get('content-type') });
  return HttpResponse.json({});
}));
beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
afterAll(() => msw.close());

const client = () => new BConnectClientBase({ baseUrl: 'https://bms.patch.test/bconnect', username: 'u', password: 'p' }) as unknown as {
  client: {
    patch: (u: string, d: unknown, c?: unknown) => Promise<unknown>;
    post: (u: string, d: unknown) => Promise<unknown>;
    put: (u: string, d: unknown) => Promise<unknown>;
  };
};

describe('the specs', () => {
  it('declare only application/json-patch+json for every PATCH operation', () => {
    const declared = new Set<string>();
    let count = 0;
    for (const release of ['25R2', '26R1']) {
      const dir = join(ROOT, 'openapi-specs', release);
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const spec = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        for (const ops of Object.values<Record<string, { requestBody?: { content?: object } }>>(spec.paths)) {
          if (!ops.patch) continue;
          count++;
          for (const type of Object.keys(ops.patch.requestBody?.content ?? {})) declared.add(type);
        }
      }
    }
    expect(count).toBeGreaterThan(40);
    expect([...declared]).toEqual(['application/json-patch+json']);
  });
});

describe('the shared client', () => {
  it('sends application/json-patch+json for a PATCH', async () => {
    seen = [];
    await client().client.patch(`/endpoints/v2.0/WindowsEndpoints/${ID}`, [{ op: 'replace', path: '/comment', value: 'x' }]);
    expect(seen).toEqual([{ method: 'PATCH', contentType: 'application/json-patch+json' }]);
  });

  it('keeps it when a module already set it per call', async () => {
    seen = [];
    await client().client.patch(`/software/v2.0/Bundles/${ID}`, [], { headers: { 'Content-Type': 'application/json-patch+json' } });
    expect(seen[0].contentType).toBe('application/json-patch+json');
  });

  it('keeps application/json for POST', async () => {
    seen = [];
    await client().client.post('/jobs/v2.0/JobInstances', { jobDefinitionId: ID, endpointId: ID });
    expect(seen).toEqual([{ method: 'POST', contentType: 'application/json' }]);
  });
});
