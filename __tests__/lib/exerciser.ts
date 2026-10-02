/**
 * Calls the MCP tools of every server the way a client does, and records the
 * HTTP requests they send. Shared by the guard tests (secret gate, tool-argument
 * routes, spec conformance).
 *
 * Each test file creates its own recorder (vitest isolates files), starts it in
 * `beforeAll`, and connects servers after setting the environment it needs:
 * servers read their configuration when `createServer()` runs.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setupServer } from 'msw/node';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Release } from './spec.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASE_URL = 'https://bms.guard.test/bconnect';
export const BASE_PATH = new URL(BASE_URL).pathname;
/** The GUID generated for every argument named like an ID. */
export const ID = '00000000-0000-4000-8000-000000000001';

/** The 13 server directories, sorted. */
export const SERVERS = readdirSync(ROOT).filter((d) => /^bconnect-.+-mcp$/.test(d)).sort();

/** The API domain (URL segment) a server calls; groups uses the endpoints API. */
export function domainOf(server: string): string {
  const name = server.replace(/^bconnect-/, '').replace(/-mcp$/, '');
  return name === 'groups' ? 'endpoints' : name;
}

export type JsonSchema = Record<string, any>;

/** A value that passes the servers' argument validation for the given property. */
export function sample(name: string, schema: JsonSchema): unknown {
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

/** Sample values for the required arguments of a tool. */
export function requiredArguments(inputSchema: JsonSchema): Record<string, unknown> {
  const required: string[] = inputSchema.required ?? [];
  const args: Record<string, unknown> = {};
  const properties = Object.entries<JsonSchema>(inputSchema.properties ?? {});
  for (const [name, schema] of properties) {
    if (required.includes(name)) args[name] = sample(name, schema);
  }
  // A tool that needs more than its required arguments (e.g. "id plus at least
  // one field to change") says so with minProperties; fill up with optional ones.
  for (const [name, schema] of properties) {
    if (Object.keys(args).length >= (inputSchema.minProperties ?? 0)) break;
    if (!(name in args)) args[name] = sample(name, schema);
  }
  return args;
}

/** The value of the undeclared argument added by `allArguments`; it must never reach the wire. */
export const UNKNOWN_NAME = 'zzGuardUnknown';
export const UNKNOWN_VALUE = 'zz-guard-unknown-argument';

/**
 * Sample values for every documented argument, a distinct GUID for each ID-like
 * argument (so a path slot can be traced back to its argument), and one
 * undeclared argument.
 */
export function allArguments(inputSchema: JsonSchema): { args: Record<string, unknown>; idsByArg: Record<string, string> } {
  const args: Record<string, unknown> = {};
  const idsByArg: Record<string, string> = {};
  let n = 1;
  for (const [name, schema] of Object.entries<JsonSchema>(inputSchema.properties ?? {})) {
    if (schema.type === 'string' && /id$/i.test(name)) {
      idsByArg[name] = `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`;
      args[name] = idsByArg[name];
    } else {
      args[name] = sample(name, schema);
    }
  }
  args[UNKNOWN_NAME] = UNKNOWN_VALUE;
  return { args, idsByArg };
}

/** One HTTP request as a server sent it. `path` is below the base URL, e.g. `/jobs/v2.0/Folders`. */
export interface RecordedRequest {
  method: string;
  path: string;
  url: URL;
  query: Array<[string, string]>;
  contentType: string | null;
  body: string;
}

/** Answers every request and records it. `respond` decides the JSON body (default `{}`). */
export function createRecorder(respond: (r: RecordedRequest) => JsonBodyType = () => ({})) {
  let recorded: RecordedRequest[] = [];
  const msw = setupServer(
    http.all('*', async ({ request }) => {
      const url = new URL(request.url);
      const entry: RecordedRequest = {
        method: request.method,
        path: url.pathname.slice(BASE_PATH.length),
        url,
        query: [...url.searchParams.entries()],
        contentType: request.headers.get('content-type'),
        body: await request.clone().text(),
      };
      recorded.push(entry);
      return HttpResponse.json(respond(entry));
    }),
  );
  return {
    listen: (): void => msw.listen({ onUnhandledRequest: 'error' }),
    close: (): void => msw.close(),
    /** Requests recorded since the last call. */
    take: (): RecordedRequest[] => {
      const out = recorded;
      recorded = [];
      return out;
    },
  };
}

/** The environment every exercise starts from; gates are set per call. */
export function guardEnv(release: Release, gates: { writes: boolean; secretRead: boolean }): Record<string, string> {
  return {
    BCONNECT_BASE_URL: BASE_URL,
    BCONNECT_USERNAME: 'guard',
    BCONNECT_PASSWORD: 'guard',
    BCONNECT_SKIP_CONNECTIVITY_CHECK: 'true',
    BCONNECT_RELEASE: release,
    // Empty, not deleted: dotenv never overrides a key that is present.
    ALLOW_WRITE_OPERATIONS: gates.writes ? 'true' : '',
    ALLOW_SECRET_READ: gates.secretRead ? 'true' : '',
  };
}

export interface ToolResult {
  text: string;
  isError: boolean;
  /** JSON-RPC error code, when the call failed with a protocol error rather than an error result. */
  code?: number;
}

export interface ConnectedServer {
  tools: Array<{ name: string; inputSchema: JsonSchema }>;
  call(tool: string, args: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

/**
 * Create one server with the current environment and connect an in-memory MCP client.
 * `credentials` are passed to `createServer()` the way the gateway passes per-request ones.
 */
export async function connect(server: string, credentials?: Record<string, string>): Promise<ConnectedServer> {
  const mod = await import(pathToFileURL(join(ROOT, server, 'src', 'index.ts')).href);
  const { server: mcp } = mod.createServer(credentials);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'guard', version: '0' });
  await Promise.all([mcp.connect(serverSide), client.connect(clientSide)]);
  const tools = (await client.listTools()).tools as ConnectedServer['tools'];
  return {
    tools,
    async call(tool, args) {
      try {
        const result = await client.callTool({ name: tool, arguments: args });
        return { text: JSON.stringify(result.content ?? ''), isError: result.isError === true };
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        return { text: String((error as Error).message), isError: true, ...(typeof code === 'number' && { code }) };
      }
    },
    close: () => client.close(),
  };
}
