/**
 * Protocol errors (#326): unknown tool, invalid arguments, a tool the selected
 * release doesn't have. They stay JSON-RPC errors; everything else is a tool
 * result with `isError` (tool-errors.ts).
 *
 * The SDK's McpError puts "MCP error <code>: " in front of its message, the
 * server sends that message, and the SDK client puts the prefix in front again.
 * protocolError() keeps the message bare, so a client shows the prefix once.
 * Production code builds every protocol error here (protocol-errors.guard).
 */
import { type ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

export function protocolError(code: ErrorCode, message: string, data?: unknown): McpError {
  const error = new McpError(code, message, data);
  error.message = message;
  return error;
}
