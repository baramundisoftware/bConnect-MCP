/**
 * bConnect API Client — bconnect-assets-mcp
 *
 * Thin subclass of the shared BConnectClientBase (@bconnect/mcp-core). All HTTP,
 * auth, retry, caching, audit, rate-limiting and error handling live in the base;
 * this class only wires this server's domain module.
 */
import { BConnectClientBase, type BConnectConfig } from "@bconnect/mcp-core";
import { AssetsModule } from "./modules/assets.js";

export type { BConnectConfig };

export class BConnectClient extends BConnectClientBase {
  public assets = new AssetsModule(this.client);
}
