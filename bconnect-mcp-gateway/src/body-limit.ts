/**
 * bconnect-mcp-gateway — MCP_GATEWAY_MAX_BODY (#330).
 *
 * The body parser reads an unknown unit as a plain number ("1m" is 1 byte,
 * "10mib" 10 bytes) and an empty value as no limit at all. The setting is
 * therefore parsed here, and the parser gets a byte count.
 */

const UNITS: Record<string, number> = { "": 1, b: 1, kb: 1024, mb: 1024 ** 2 };
const MIN_BYTES = 1024;
const MAX_BYTES = 100 * 1024 ** 2;
const DEFAULT_BYTES = 1024 ** 2;

/**
 * The body limit in bytes. Unset or empty gives 1mb; otherwise a whole number,
 * optionally followed by b, kb or mb (1kb = 1024 bytes, any case), from 1kb to
 * 100mb. Anything else throws, with the variable and what it accepts.
 */
export function maxBodyBytes(setting: string | undefined = process.env.MCP_GATEWAY_MAX_BODY): number {
  const raw = (setting ?? "").trim();
  if (raw === "") {return DEFAULT_BYTES;}
  const match = /^(\d+) ?([a-z]*)$/i.exec(raw);
  const unit = match ? match[2].toLowerCase() : undefined;
  const bytes = match && unit !== undefined && Object.hasOwn(UNITS, unit) ? Number(match[1]) * UNITS[unit] : NaN;
  if (!(bytes >= MIN_BYTES && bytes <= MAX_BYTES)) {
    throw new Error(
      `MCP_GATEWAY_MAX_BODY=${JSON.stringify(setting)} isn't valid. ` +
        "Use a whole number of bytes, kb or mb (for example 512kb or 2mb), from 1kb to 100mb.",
    );
  }
  return bytes;
}
