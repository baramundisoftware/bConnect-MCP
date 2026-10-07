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

/** `type "WindowsEndpoint"`, `without type`, `kind "Static" and member "Red"`, `kind "Static" without member`: as the servers say it. */
export function describeVariant(select: Record<string, string | null>): string {
  const parts = Object.entries(select).map(([name, value]) => (value === null ? `without ${name}` : `${name} "${value}"`));
  return parts.map((part, i) => (i === 0 ? part : `${part.startsWith('without ') ? ' ' : ' and '}${part}`)).join('');
}

/** The arguments that call a variant: its selectors with a value. */
export function selectorArguments(key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(variantOf(key).select).filter(([, v]) => v !== null)) as Record<string, string>;
}

/**
 * Whether one part of an "Only for …" / "Not for …" note names the route `select`: its full
 * label (`groupKind "LogicalGroup" and memberType "MacEndpoint"`), or, for a tool with two or
 * more selectors, a whole slice of one selector (`memberType "WindowsEndpoint", "MacEndpoint"`,
 * `without memberType`).
 */
export function partNames(part: string, select: Record<string, string | null>): boolean {
  if (part === describeVariant(select)) return true;
  if (part.includes(' and ')) return false;
  if (part.startsWith('without ')) {
    const name = part.slice('without '.length);
    return !name.includes(' ') && name in select && select[name] === null;
  }
  const space = part.indexOf(' ');
  const name = part.slice(0, space);
  if (space < 0 || !(name in select) || part.includes(' without ')) return false;
  const values: unknown[] = JSON.parse(`[${part.slice(space + 1)}]`);
  return values.includes(select[name]);
}

/** Whether a property with this description is taken by the route `select`: true without a note. */
export function routeTakes(description: unknown, select: Record<string, string | null>): boolean {
  const m = /(Only|Not) for (.+)\.$/.exec(String(description ?? ''));
  if (!m) return true;
  const named = m[2].split('; ').some((part) => partNames(part, select));
  return m[1] === 'Only' ? named : !named;
}
