/**
 * Tool results are compact JSON, formatted in one place (REQ-SRV-025, #164, ADR-0011).
 *
 * Every tool result that carries data is written by `toolJson`. Compact JSON
 * by default: indentation is 16–22 % of a result and stays in the model's
 * context. BCONNECT_PRETTY_JSON=true restores the two-space format for
 * debugging. Error results come from `toolErrorResult` (tool-errors.ts).
 */
export interface ToolJsonResult {
  /** The SDK's CallTool handler result type has an index signature. */
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

export interface ToolJsonOptions {
  /** A line before the JSON, e.g. "Network endpoint <id> updated:". */
  lead?: string;
}

/**
 * A tool's data as JSON text: compact, or indented with BCONNECT_PRETTY_JSON=true.
 * Read on every call, like the write gate. The strict check is at startup
 * (prettyJsonSetting in clientConfigFromEnv); here an odd value just gives
 * compact JSON, so formatting never fails a call whose bMS work is done.
 * `undefined` becomes `null`, so a result always has text.
 */
export function toolJson(value: unknown, env: NodeJS.ProcessEnv = process.env): string {
  const indent = (env.BCONNECT_PRETTY_JSON ?? "").trim().toLowerCase() === "true" ? 2 : undefined;
  return JSON.stringify(value, null, indent) ?? "null";
}

/** The tool result for `value`: one text content, with `lead` on its own line before the JSON. */
export function toolJsonResult(value: unknown, options: ToolJsonOptions = {}): ToolJsonResult {
  const json = toolJson(value);
  const text = options.lead === undefined ? json : `${options.lead}\n${json}`;
  return { content: [{ type: "text", text }] };
}
