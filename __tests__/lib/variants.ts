/**
 * Variant keys of merged tools (REQ-SRV-029, ADR-0015): `list_endpoints[type=WindowsEndpoint]`
 * is the route list_endpoints calls with type "WindowsEndpoint"; `list_endpoints[type=]` the one
 * without a type. Parsed here on their own, so the guards don't trust the core's parser.
 */
export interface Variant {
  /** The tool name (the key itself for a tool without variants). */
  tool: string;
  /** Selector → value; null when the selector is omitted. Empty for a tool without variants. */
  select: Record<string, string | null>;
}

export function variantOf(key: string): Variant {
  const m = key.match(/^([a-z0-9_]+)\[(.*)\]$/);
  if (!m) return { tool: key, select: {} };
  const select: Record<string, string | null> = {};
  for (const part of m[2].split(',')) {
    const [name, value] = part.split('=');
    select[name] = value === '' ? null : value;
  }
  return { tool: m[1], select };
}

/** `type "WindowsEndpoint"`, `without type`, `kind "Static" and member "Red"`: as the servers say it. */
export function describeVariant(select: Record<string, string | null>): string {
  return Object.entries(select).map(([name, value]) => (value === null ? `without ${name}` : `${name} "${value}"`)).join(' and ');
}

/** The arguments that call a variant: its selectors with a value. */
export function selectorArguments(key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(variantOf(key).select).filter(([, v]) => v !== null)) as Record<string, string>;
}
