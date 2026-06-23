/**
 * bConnect API Client — bconnect-endpoints-mcp
 *
 * Thin subclass of the shared BConnectClientBase (@bconnect/mcp-core). All HTTP,
 * auth, retry, caching, audit, rate-limiting and error handling live in the base;
 * this class only wires this server's domain module.
 */
import { BConnectClientBase, type BConnectConfig } from "@bconnect/mcp-core";
import { EndpointsModule } from "./modules/endpoints.js";

export type { BConnectConfig };

export class BConnectClient extends BConnectClientBase {
  public endpoints = new EndpointsModule(this.client);
}
