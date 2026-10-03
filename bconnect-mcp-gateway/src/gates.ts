/**
 * bconnect-mcp-gateway — write and secret gates stay closed.
 *
 * The gateway has no built-in authentication (ADR-0003), and it hosts the 13
 * servers in its own process, where they read ALLOW_WRITE_OPERATIONS and
 * ALLOW_SECRET_READ from process.env on every call. Whoever reaches the gateway
 * would get what those gates allow, so they stay closed until the gateway has
 * its own authentication (REQ-SRV-017 D3).
 *
 * Setting them to "" rather than deleting them matters: the servers call
 * dotenv.config() per request, and dotenv fills in a variable that is missing,
 * but never one that is set, so a .env file in the working directory can't
 * open them again.
 */

/** The gates the gateway keeps closed. */
export const CLOSED_GATES = ["ALLOW_WRITE_OPERATIONS", "ALLOW_SECRET_READ"] as const;

/** Closes the gates; returns the ones that were set, so the caller can warn. */
export function closeGates(env: NodeJS.ProcessEnv = process.env): string[] {
  // Named, not looped over CLOSED_GATES: the gateway-env guard lists every variable by name.
  const ignored: string[] = [];
  if ((env.ALLOW_WRITE_OPERATIONS ?? "").trim() !== "") {ignored.push("ALLOW_WRITE_OPERATIONS");}
  if ((env.ALLOW_SECRET_READ ?? "").trim() !== "") {ignored.push("ALLOW_SECRET_READ");}
  env.ALLOW_WRITE_OPERATIONS = "";
  env.ALLOW_SECRET_READ = "";
  return ignored;
}
