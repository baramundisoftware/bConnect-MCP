/**
 * bConnect API Client — SERVER TEMPLATE
 *
 * When you scaffold a new server from this template, wire your domain module(s)
 * below. All shared plumbing — HTTP, auth, retry, response caching, audit
 * logging, rate limiting and error handling — lives ONCE in BConnectClientBase
 * (@bconnect/mcp-core). Do NOT copy that plumbing per server.
 *
 * Example:
 *   import { DomainModule } from "./modules/domain.js";
 *   export class BConnectClient extends BConnectClientBase {
 *     public domain = new DomainModule(this.client);
 *   }
 */
import { BConnectClientBase, type BConnectConfig } from "@bconnect/mcp-core";
// import { DomainModule } from "./modules/domain.js";

export type { BConnectConfig };

export class BConnectClient extends BConnectClientBase {
  // Wire this server's domain module(s) here, e.g.:
  // public domain = new DomainModule(this.client);
}
