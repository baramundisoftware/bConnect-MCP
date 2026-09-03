/**
 * Test helper — connect to the server the way a real client does.
 *
 * Upstream finding OPT-39. createServer() used to override `server.request()`
 * and reach into the SDK's private `_requestHandlers` map so tests could
 * dispatch handlers directly. That override shipped in production and depended
 * on an undocumented SDK internal. It is gone; this helper replaces it with the
 * InMemoryTransport pair the SDK supports publicly, which is how eleven of the
 * other twelve servers already test the same factory.
 *
 * Going through a real client also makes the tests stronger than the old direct
 * dispatch: requests and responses are validated against the protocol schemas
 * on the way through, so a malformed tool definition fails here rather than in
 * a client.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer, type BConnectCredentials } from "../../index.js";

/**
 * Start the server over a linked in-memory transport pair and return a
 * connected client.
 */
export async function connectTestClient(credentials?: BConnectCredentials): Promise<Client> {
  const { server } = createServer(credentials);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "endpoints-test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

/** Names of every tool the server registers, in registration order. */
export async function listToolNames(credentials?: BConnectCredentials): Promise<string[]> {
  const client = await connectTestClient(credentials);
  const { tools } = await client.listTools();
  return tools.map((tool) => tool.name);
}
