/**
 * Host and Origin check for the HTTP transports (DNS-rebinding protection):
 * the gateway and every server's HTTP mode answer only allowed host names.
 */
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowedHosts, hostCheckRefusal } from '../packages/mcp-core/src/host-check.js';
import { ROOT } from './lib/exerciser.js';

describe('allowedHosts', () => {
  it('always allows the loopback names', () => {
    expect(allowedHosts(undefined)).toEqual(['localhost', '127.0.0.1', '[::1]']);
  });

  it('adds listed names, lower-cased, without ports or schemes, once each', () => {
    expect(allowedHosts(' mcp-gateway , MCP.Company.com:443,https://proxy.example ,,localhost'))
      .toEqual(['localhost', '127.0.0.1', '[::1]', 'mcp-gateway', 'mcp.company.com', 'proxy.example']);
  });

  it('accepts an IPv6 address with or without brackets', () => {
    expect(allowedHosts('fd00::1,[fd00::2]')).toEqual(['localhost', '127.0.0.1', '[::1]', '[fd00::1]', '[fd00::2]']);
  });

  it('reports entries that can never match instead of dropping them silently', () => {
    const ignored: string[] = [];
    expect(allowedHosts('*.corp, mcp gw, host/path, ok.example', (e) => ignored.push(e))).toContain('ok.example');
    expect(ignored).toEqual(['*.corp', 'mcp gw', 'host/path']);
  });
});

describe('hostCheckRefusal', () => {
  const allowed = allowedHosts('mcp-gateway');

  it.each(['localhost:3001', '127.0.0.1:3001', '[::1]:3001', 'mcp-gateway:3001', 'MCP-GATEWAY'])('accepts Host %s', (host) => {
    expect(hostCheckRefusal({ host }, allowed)).toBeUndefined();
  });

  it.each(['evil.example', 'evil.example:3001', '127.0.0.1.evil.example', 'localhost.evil.example', '10.0.0.5:3001',
    'x@localhost', 'evil.example:3001@localhost', 'localhost/evil', 'localhost\\evil', 'localhost?x', 'localhost#x', '%6cocalhost', 'localhost.'])('refuses Host %s', (host) => {
    expect(hostCheckRefusal({ host }, allowed)).toBe('host');
  });

  it('refuses a request without a Host header or with an unparseable one', () => {
    expect(hostCheckRefusal({}, allowed)).toBe('host');
    expect(hostCheckRefusal({ host: 'a b' }, allowed)).toBe('host');
  });

  it('accepts a browser request from an allowed origin', () => {
    expect(hostCheckRefusal({ host: 'localhost:3001', origin: 'http://localhost:3001' }, allowed)).toBeUndefined();
  });

  it.each(['http://evil.example', 'null', 'https://evil.example:3001', 'file://', 'http://localhost@evil.example', 'http://localhost/path'])('refuses Origin %s even with an allowed Host', (origin) => {
    expect(hostCheckRefusal({ host: 'localhost:3001', origin }, allowed)).toBe('origin');
  });
});

/** A port nothing listens on right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** POST an MCP initialize with explicit headers (fetch can't set Host). */
function post(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    });
    const req = http.request({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('gateway', () => {
  it('answers allowed host names and refuses a rebinding host name or a foreign origin', async () => {
    process.env.MCP_GATEWAY_ALLOWED_HOSTS = 'mcp-gateway';
    const { createApp } = await import('../bconnect-mcp-gateway/src/app.js');
    const server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as { port: number };
      expect((await post(port, '/endpoints/mcp', { Host: `localhost:${port}` })).status).toBe(200);
      expect((await post(port, '/endpoints/mcp', { Host: 'mcp-gateway:3001' })).status).toBe(200);
      const rebinding = await post(port, '/endpoints/mcp', { Host: `evil.example:${port}` });
      expect(rebinding.status).toBe(403);
      expect(rebinding.body).not.toMatch(/serverInfo/);
      expect((await post(port, '/endpoints/mcp', { Host: `localhost:${port}`, Origin: 'http://evil.example' })).status).toBe(403);
    } finally {
      server.close();
      delete process.env.MCP_GATEWAY_ALLOWED_HOSTS;
    }
  });
});

describe('servers in HTTP mode', () => {
  // Every server starts through the core's runServer() (client-config guard, REQ-SRV-023),
  // so the HTTP mode of all of them is this one routine.
  it('the shared startup routine checks the host name before its MCP handler', () => {
    const source = readFileSync(join(ROOT, 'packages', 'mcp-core', 'src', 'server-runtime.ts'), 'utf8');
    const check = source.indexOf('app.use(hostCheck(hosts');
    expect(source).toContain('const hosts = allowedHosts(env.MCP_ALLOWED_HOSTS');
    expect(check).toBeGreaterThan(-1);
    // Before the body parser and the MCP handler, so a refused request isn't parsed first.
    expect(check).toBeLessThan(source.indexOf('app.use(express.json())'));
    expect(check).toBeLessThan(source.indexOf('app.post("/mcp"'));
  });

  it('a built server refuses a rebinding host name and answers localhost', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, [join(ROOT, 'bconnect-endpoints-mcp', 'build', 'index.js')], {
      env: {
        PATH: process.env.PATH ?? '', MCP_TRANSPORT: 'http', MCP_PORT: String(port),
        BCONNECT_BASE_URL: 'https://bms.example.com/bconnect', BCONNECT_API_KEY: 'k',
        BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
        child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited with ${code}`)); });
        child.stderr.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('listening on')) { clearTimeout(timer); resolve(); }
        });
      });
      expect((await post(port, '/mcp', { Host: `evil.example:${port}` })).status).toBe(403);
      expect((await post(port, '/mcp', { Host: `localhost:${port}` })).status).toBe(200);
    } finally {
      child.kill();
    }
  }, 20000);
});
