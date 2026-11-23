/**
 * A list of MCP domains as a setting or an argument gives it (#131, #297).
 *
 * The gateway's MCP_GATEWAY_COMBINED and the domain argument of the
 * `bconnect-mcp` package take the same form: `all`, or domain names separated
 * by commas (any case; spaces and empty entries ignored, a name given twice
 * counts once). The domains come back in the order of `known`.
 */

/**
 * The chosen domains, or undefined when `value` is unset or empty. `all` gives
 * every known domain. `all` with other names, a list that names no domain, or a
 * name that isn't a domain throws, naming `label` and what it accepts.
 */
export function domainList(value: string | undefined, known: readonly string[], label: string): string[] | undefined {
  const raw = (value ?? "").trim();
  if (raw === "") {return undefined;}
  const refuse = (reason: string): never => {
    throw new Error(
      `${label}=${JSON.stringify(value)} isn't valid: ${reason}. ` +
        `Use all, or domain names separated by commas: ${known.join(", ")}.`,
    );
  };
  const names = raw.split(",").map((name) => name.trim().toLowerCase()).filter((name) => name !== "");
  if (names.length === 0) {return refuse("it names no domain");}
  if (names.includes("all")) {
    return names.every((name) => name === "all") ? [...known] : refuse("all stands alone");
  }
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    return refuse(`${unknown.map((name) => JSON.stringify(name)).join(", ")} ${unknown.length === 1 ? "is" : "are"} not a domain`);
  }
  return known.filter((domain) => names.includes(domain));
}
