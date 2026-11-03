/**
 * One MCP server that offers the tools of several domain servers (#131).
 *
 * Each domain server stays as it is: it is connected in-process through the SDK's
 * in-memory transport and asked as a client would ask it. tools/list returns the
 * tools of every domain, in the order the domains are given; tools/call goes to
 * the domain that lists the tool. A name no domain lists (a write tool hidden by
 * the write gate, a tool the bMS release lacks, a typo) is offered to each domain
 * in turn, so the caller gets the same refusal the domain's own endpoint gives;
 * a name no domain knows gets `Unknown tool: <name>`, as from a domain server.
 *
 * Tool names stay as the domains define them, with no domain prefix: they are
 * unique across the domains, which `combinedTools` checks (run it at startup).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { protocolError } from "./protocol-errors.js";

/** A domain server to combine: its name (e.g. `assets`) and a fresh, unconnected server. */
export interface CombinedPart {
  domain: string;
  server: Server;
}

/** The name and version the combined server reports in `initialize`. */
export interface CombinedServerInfo {
  name: string;
  version: string;
}

/**
 * No time limit on a forwarded request. A domain's own endpoint has none, so a
 * slow bMS call must not fail on the combined endpoint alone; the SDK client's
 * default would end it after 60 s. The caller's cancellation still ends it.
 * The largest delay `setTimeout` accepts.
 */
const NO_TIMEOUT_MS = 2_147_483_647;

/** The message a domain server gives for a tool name it doesn't have. */
const unknownToolMessage = (name: string): string => `Unknown tool: ${name}`;

/**
 * The error as the domain sent it. The SDK client prefixes the message of an error
 * it receives with `MCP error <code>: `; passed on unchanged, the combined endpoint
 * would answer with a different message than the domain's own endpoint.
 */
function asDomainSent(error: unknown): unknown {
  if (!(error instanceof McpError)) {
    return error;
  }
  const prefix = `MCP error ${error.code}: `;
  const message = error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
  return protocolError(error.code, message, error.data);
}

function isUnknownTool(error: unknown, name: string): boolean {
  return error instanceof McpError && error.code === ErrorCode.MethodNotFound
    && error.message === unknownToolMessage(name);
}

/** The parts, connected on first use, each through its own client. */
class Domains {
  private readonly clients = new Map<string, Promise<Client>>();

  constructor(private readonly parts: CombinedPart[], private readonly info: CombinedServerInfo) {}

  get names(): string[] {
    return this.parts.map((part) => part.domain);
  }

  client(domain: string): Promise<Client> {
    let client = this.clients.get(domain);
    if (!client) {
      const part = this.parts.find((p) => p.domain === domain);
      if (!part) {
        throw new Error(`no domain '${domain}' in the combined server`);
      }
      client = (async () => {
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        const c = new Client(this.info);
        await Promise.all([part.server.connect(serverSide), c.connect(clientSide)]);
        return c;
      })();
      this.clients.set(domain, client);
    }
    return client;
  }

  /** Every tool the domain lists, across pages. */
  async tools(domain: string, options: RequestOptions): Promise<Tool[]> {
    const client = await this.client(domain);
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.request(
        { method: "tools/list", params: cursor === undefined ? {} : { cursor } },
        ListToolsResultSchema,
        options,
      );
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return tools;
  }

  async call(domain: string, params: { name: string; arguments?: Record<string, unknown> }, options: RequestOptions): Promise<CallToolResult> {
    const client = await this.client(domain);
    // `request`, not `callTool`: the result goes back exactly as the domain gave it,
    // without the client checking it against the tool's output schema a second time.
    return client.request({ method: "tools/call", params }, CallToolResultSchema, options) as Promise<CallToolResult>;
  }

  async close(): Promise<void> {
    const clients = await Promise.allSettled(this.clients.values());
    await Promise.allSettled(clients.map((c) => (c.status === "fulfilled" ? c.value.close() : undefined)));
    await Promise.allSettled(this.parts.map((part) => part.server.close()));
  }
}

/**
 * The tools of each domain, checked for names two domains share. Throws an Error
 * naming the tool and both domains; returns the tool names per domain otherwise.
 * The combined server routes by name, so a shared name would hide one domain's tool.
 */
export async function combinedTools(parts: CombinedPart[], info: CombinedServerInfo): Promise<Record<string, string[]>> {
  const domains = new Domains(parts, info);
  try {
    const owner = new Map<string, string>();
    const perDomain: Record<string, string[]> = {};
    for (const domain of domains.names) {
      const names = (await domains.tools(domain, { timeout: NO_TIMEOUT_MS })).map((tool) => tool.name);
      for (const name of names) {
        const other = owner.get(name);
        if (other !== undefined) {
          throw new Error(`tool '${name}' is offered by both '${other}' and '${domain}'; the combined endpoint needs unique tool names`);
        }
        owner.set(name, domain);
      }
      perDomain[domain] = names;
    }
    return perDomain;
  } finally {
    await domains.close();
  }
}

/**
 * The combined server. Connect it to a transport as a domain server; closing it
 * closes the domain servers it connected. Create one per request or session, with
 * fresh domain servers, as for a domain endpoint.
 */
export function createCombinedServer(parts: CombinedPart[], info: CombinedServerInfo): { server: Server } {
  const domains = new Domains(parts, info);
  const server = new Server(info, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
    const options = { signal: extra.signal, timeout: NO_TIMEOUT_MS };
    const tools: Tool[] = [];
    const seen = new Set<string>();
    for (const domain of domains.names) {
      for (const tool of await domains.tools(domain, options)) {
        // combinedTools refuses shared names at startup; should one appear anyway,
        // the first domain keeps it, as tools/call would route it there.
        if (!seen.has(tool.name)) {
          seen.add(tool.name);
          tools.push(tool);
        }
      }
    }
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const options = { signal: extra.signal, timeout: NO_TIMEOUT_MS };
    const { name } = request.params;
    const params = { name, ...(request.params.arguments !== undefined && { arguments: request.params.arguments }) };
    try {
      for (const domain of domains.names) {
        if ((await domains.tools(domain, options)).some((tool) => tool.name === name)) {
          return await domains.call(domain, params, options);
        }
      }
      // Listed nowhere: the domain that has the tool by name refuses it with its
      // own reason; every other domain answers Unknown tool.
      for (const domain of domains.names) {
        try {
          return await domains.call(domain, params, options);
        } catch (error) {
          if (!isUnknownTool(asDomainSent(error), name)) {
            throw error;
          }
        }
      }
    } catch (error) {
      throw asDomainSent(error);
    }
    throw protocolError(ErrorCode.MethodNotFound, unknownToolMessage(name));
  });

  server.onclose = () => {
    void domains.close();
  };

  return { server };
}
