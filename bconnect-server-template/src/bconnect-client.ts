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
 *     protected override readonly probeRoute = "/domain/v2.0/Items";
 *     public domain = new DomainModule(this.client);
 *   }
 */
import { BConnectClientBase, type BConnectConfig } from "@bconnect/mcp-core";
// import { DomainModule } from "./modules/domain.js";

export type { BConnectConfig };

export class BConnectClient extends BConnectClientBase {
  // Startup connectivity check: set a GET list route of this server's domain
  // that exists in the spec and accepts PageSize, e.g.:
  // protected override readonly probeRoute = "/domain/v2.0/Items";

  // Wire this server's domain module(s) here, e.g.:
  // public domain = new DomainModule(this.client);
}
