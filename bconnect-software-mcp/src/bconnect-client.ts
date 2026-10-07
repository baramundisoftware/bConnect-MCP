/**
 * bConnect API Client — bconnect-software-mcp
 *
 * Thin subclass of the shared BConnectClientBase (@bconnect/mcp-core). All HTTP,
 * auth, retry, caching, audit, rate-limiting and error handling live in the base;
 * this class only wires this server's domain module.
 */
import { BConnectClientBase, selectedRelease, type BConnectConfig } from "@bconnect/mcp-core";
import { SoftwareModule } from "./modules/software.js";

export type { BConnectConfig };

/**
 * The startup check's route (#202): InstalledWindowsSoftware answered only after
 * 30 s on a real bMS, so 26R1 probes the light Bundles list. Any other release
 * falls back to the route every release has; 25R2 has no other list route.
 * Asked at check time, so it follows the detected release (#159).
 */
function probeRouteFor(release: string): string {
  return release === "26R1" ? "/software/v2.0/Bundles" : "/software/v2.0/InstalledWindowsSoftware";
}

export class BConnectClient extends BConnectClientBase {
  protected override probePath(): string {
    return probeRouteFor(selectedRelease());
  }
  public software = new SoftwareModule(this.client);
}
