/**
 * One startup routine and one client per server (REQ-SRV-023, #160, ADR-0010).
 *
 * Each server creates its client registry once (`serverClients`) and starts
 * through `runServer`. Every tool call then uses the same client, so the rate
 * limit, the CA read and connection reuse work across calls, in stdio, HTTP
 * mode and the gateway alike, and the startup check uses that same client.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import * as dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { BConnectClientBase, BConnectConfig, ClientOptions } from "./bconnect-client-base.js";
import { CLIENT_ENV_VARS, clientConfigFromEnv, hasRequestCredentials, type BConnectCredentials } from "./client-config.js";
import { RateLimiter } from "./rate-limiter.js";
import { allowedHosts, hostCheck } from "./host-check.js";

export type { ClientOptions } from "./bconnect-client-base.js";

/** A server's client class: the core base plus the server's domain module. */
export type ClientClass<C extends BConnectClientBase> = new (config: Readonly<BConnectConfig>, options?: ClientOptions) => C;

export interface ServerClients<C extends BConnectClientBase> {
  /**
   * The client for a tool call: the server's shared client, or, for a request
   * that brings its own credentials, that session's own client. Throws a
   * ClientConfigError when the settings are incomplete or invalid.
   */
  get(credentials?: BConnectCredentials): C;
}

const loadedEnvFiles = new Set<string>();
/** The working directory's .env, resolved on first use: a later directory change loads nothing new. */
let defaultEnvFile: string | undefined;

/**
 * Loads a .env file (default: the working directory's) once per process,
 * quietly: stdout carries JSON-RPC in stdio mode. dotenv never overrides a
 * variable that is already set, so a value set to "" (the gateway's closed
 * gates) stays as it is.
 */
export function loadEnvOnce(path?: string, env: NodeJS.ProcessEnv = process.env): void {
  const file = path === undefined ? (defaultEnvFile ??= resolve(".env")) : resolve(path);
  if (loadedEnvFiles.has(file)) {return;}
  loadedEnvFiles.add(file);
  dotenv.config({ path: file, processEnv: env as dotenv.DotenvPopulateInput, quiet: true } as dotenv.DotenvConfigOptions);
}

/**
 * The values of the client settings, hashed: a change means a new client.
 * Exactly the variables clientConfigFromEnv reads (CLIENT_ENV_VARS, pinned by
 * a test), so the environment scanners find each read there by name.
 */
function settingsKey(settings: NodeJS.ProcessEnv): string {
  const values = CLIENT_ENV_VARS.map((name) => settings[name] ?? null);
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

/** The process environment (a default parameter, so environment scanners see where reads come from). */
const processEnvironment = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => env;

const registries = new Set<{ reset(): void }>();

/** Forgets every server's clients and rate limiters (tests that need a fresh client). */
export function resetServerClients(): void {
  for (const registry of registries) {registry.reset();}
}

/**
 * The client registry of one server (D1 = a): one client per process for
 * the environment's settings, rebuilt only when a setting changes; one client
 * per credentials object for requests that bring their own; one rate limiter
 * for all of them.
 */
export function serverClients<C extends BConnectClientBase>(Client: ClientClass<C>, settings?: NodeJS.ProcessEnv): ServerClients<C> {
  let shared: { key: string; client: C } | undefined;
  let sessions = new WeakMap<BConnectCredentials, { key: string; client: C }>();
  let limiter: { key: string; limiter: RateLimiter } | undefined;
  registries.add({ reset: () => { shared = undefined; sessions = new WeakMap(); limiter = undefined; } });

  const limiterFor = (config: Readonly<BConnectConfig>): RateLimiter | undefined => {
    const rate = config.rateLimit;
    if (!rate?.enabled) {return undefined;}
    const key = `${rate.maxRequests}/${rate.windowMs}`;
    if (limiter?.key !== key) {
      limiter = { key, limiter: new RateLimiter({ enabled: true, maxRequests: rate.maxRequests || 100, windowMs: rate.windowMs || 60000, message: rate.message }) };
    }
    return limiter.limiter;
  };
  const build = (env: NodeJS.ProcessEnv, credentials?: BConnectCredentials): C => {
    const config = clientConfigFromEnv(env, credentials);
    return new Client(config, { rateLimiter: limiterFor(config) });
  };

  return {
    get(credentials) {
      // Servers read the process environment, after the .env file; tests pass their own settings.
      if (settings === undefined) {loadEnvOnce();}
      const env = settings ?? processEnvironment();
      const key = settingsKey(env);
      if (!hasRequestCredentials(credentials)) {
        if (shared?.key !== key) {shared = { key, client: build(env) };}
        return shared.client;
      }
      let session = sessions.get(credentials);
      if (session?.key !== key) {
        session = { key, client: build(env, credentials) };
        sessions.set(credentials, session);
      }
      return session.client;
    },
  };
}

export interface ServerEntry<C extends BConnectClientBase> {
  /** The package name, e.g. "bconnect-compliance-mcp"; it starts every log line. */
  name: string;
  createServer: () => { server: Server };
  clients: ServerClients<C>;
}

/** Where the startup routine reads and writes; tests replace it. */
export interface StartupIo {
  env: NodeJS.ProcessEnv;
  /** Loads the .env file into `env` (the process's; tests leave it out). */
  loadEnv?: () => void;
  /** One line to stderr (stdout carries JSON-RPC in stdio mode). */
  error: (line: string) => void;
  exit: (code: number) => never;
  connectStdio: (server: Server) => Promise<void>;
  /** Hears about the HTTP listener once it listens (tests close it). */
  listening?: (server: HttpServer) => void;
}

const processIo = (env: NodeJS.ProcessEnv = process.env): StartupIo => ({
  env,
  loadEnv: () => loadEnvOnce(),
  error: (line) => console.error(line),
  exit: (code) => process.exit(code),
  connectStdio: (server) => server.connect(new StdioServerTransport()),
});

/** An error as one line: no stack, no line breaks that could forge log lines. */
const oneLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .split(/[\r\n]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");

/**
 * The one startup routine (REQ-SRV-023 AC 2, AC 3): loads .env once, checks
 * the settings by building the shared client, runs the connectivity check
 * with it (or says it was skipped), then serves stdio or HTTP. Any failure
 * is one stderr line `<name>: <message>` and exit code 1.
 */
export async function startServer<C extends BConnectClientBase>(entry: ServerEntry<C>, io: StartupIo = processIo()): Promise<void> {
  const failure = await serve(entry, io).catch((error: unknown) => oneLine(error));
  if (failure !== undefined) {
    io.error(`${entry.name}: ${failure}`);
    io.exit(1);
  }
}

/** Starts the server; returns why it couldn't, or undefined. */
async function serve<C extends BConnectClientBase>(entry: ServerEntry<C>, io: StartupIo): Promise<string | undefined> {
  const { name } = entry;
  const env = io.env;
  io.loadEnv?.();
  const client = entry.clients.get();
  if (env.BCONNECT_SKIP_CONNECTIVITY_CHECK === "true") {
    io.error(`${name}: connectivity check skipped (BCONNECT_SKIP_CONNECTIVITY_CHECK=true); the settings were checked.`);
  } else {
    io.error(`${name}: verifying bConnect API connectivity...`);
    const reason = await client.checkConnection();
    if (reason !== undefined) {
      return `cannot reach bConnect API at ${client.baseUrl} (${oneLine(reason)}). Check BCONNECT_BASE_URL, credentials, and network.`;
    }
    io.error(`${name}: API connectivity verified.`);
  }

  if ((env.MCP_TRANSPORT ?? "stdio") === "http") {
    return await serveHttp(entry, io);
  }
  const { server } = entry.createServer();
  await io.connectStdio(server);
  io.error(`${name} started on stdio`);
  return undefined;
}

/** Standalone HTTP mode: stateless, one server per request, all sharing the server's client. */
async function serveHttp<C extends BConnectClientBase>(entry: ServerEntry<C>, io: StartupIo): Promise<string | undefined> {
  const { name } = entry;
  const env = io.env;
  const port = parseInt(env.MCP_PORT ?? "3000", 10);
  const bind = env.MCP_BIND ?? "127.0.0.1";
  // Standalone HTTP mode has no client authentication. Binding to a non-loopback
  // address would expose an unauthenticated bConnect proxy, so fail closed unless
  // the operator explicitly opts in (front it with the authenticated gateway instead).
  const isLoopbackBind = bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
  if (!isLoopbackBind && env.MCP_ALLOW_NO_AUTH !== "true") {
    return `refusing to bind ${bind} — standalone HTTP mode is unauthenticated. ` +
      "Bind to loopback (the default) and front it with the authenticated gateway, " +
      "or set MCP_ALLOW_NO_AUTH=true to override.";
  }

  const app = express();
  // Only requests addressed to an allowed host name (DNS-rebinding protection), checked first.
  const hosts = allowedHosts(env.MCP_ALLOWED_HOSTS, (hostEntry) => {
    io.error(`${name}: MCP_ALLOWED_HOSTS entry ${JSON.stringify(hostEntry)} ignored: not a host name or address`);
  });
  app.use(hostCheck(hosts, (reason) => {
    io.error(`${name}: refused a request whose ${reason} isn't an allowed host name (MCP_ALLOWED_HOSTS)`);
  }));
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const { server } = entry.createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/mcp", (_req, res) => {
    res.writeHead(405).end(JSON.stringify({ error: "Method Not Allowed. Use POST for MCP requests." }));
  });
  app.delete("/mcp", (_req, res) => {
    res.writeHead(405).end(JSON.stringify({ error: "Method Not Allowed. Session management not supported in stateless mode." }));
  });

  // Malformed JSON and other request errors: a JSON-RPC error, never Express's HTML page with a stack.
  app.use((error: { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const parse = error.type === "entity.parse.failed";
    const status = typeof error.status === "number" && error.status >= 400 && error.status < 600 ? error.status : 500;
    res.status(status).json({ jsonrpc: "2.0", error: { code: parse ? -32700 : -32603, message: parse ? "Parse error" : "Internal error" }, id: null });
  });

  // A port in use or an address that can't be bound is a startup error like any other: one line.
  const listener = app.listen(port, bind);
  await new Promise<void>((resolveListen, reject) => {
    listener.once("error", reject);
    listener.once("listening", () => {
      // Only startup errors are reported this way; a later error is not swallowed here.
      listener.off("error", reject);
      resolveListen();
    });
  });
  // The port it really listens on: with MCP_PORT=0 the system picks one.
  const listening = (listener.address() as AddressInfo | null)?.port ?? port;
  io.error(`${name} listening on http://${bind}:${listening}/mcp`);
  io.listening?.(listener);
  return undefined;
}

/**
 * A server's entry point: starts it, unless the module is only imported by
 * a test (VITEST), where createServer() is called directly.
 */
export function runServer<C extends BConnectClientBase>(entry: ServerEntry<C>): void {
  if (!process.env.VITEST) {
    void startServer(entry);
  }
}
