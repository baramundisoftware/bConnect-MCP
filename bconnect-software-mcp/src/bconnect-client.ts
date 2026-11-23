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
 * 30 s on a real bMS, so 26R1 and later probe the light Bundles list. 25R2 has
 * no Bundles route and keeps the list every release has.
 * Asked at check time, so it follows the detected release (#159).
 */
function probeRouteFor(release: string): string {
  return release === "25R2" ? "/software/v2.0/InstalledWindowsSoftware" : "/software/v2.0/Bundles";
}

export class BConnectClient extends BConnectClientBase {
  protected override probePath(): string {
    return probeRouteFor(selectedRelease());
  }
  public software = new SoftwareModule(this.client);
}
