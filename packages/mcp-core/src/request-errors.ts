/**
 * Request errors on the HTTP transports (REQ-GW-004).
 *
 * The gateway and every server's HTTP mode register this handler last: a body
 * that can't be read (malformed JSON, over the size limit, an unsupported
 * charset) or a handler that fails gets a JSON-RPC error, never Express's HTML
 * page, and never the error's own message.
 */

export interface JsonRpcErrorBody {
  jsonrpc: "2.0";
  error: { code: number; message: string };
  id: null;
}

/**
 * The answer to a request error: malformed JSON → JSON-RPC -32700 "Parse error",
 * anything else → -32603 "Internal error". The status is the error's own when it
 * is a 4xx/5xx (body-parser errors carry one), 500 otherwise.
 */
export function requestErrorAnswer(error: unknown): { status: number; body: JsonRpcErrorBody } {
  const fields = typeof error === "object" && error !== null ? error : {};
  const parse = "type" in fields && fields.type === "entity.parse.failed";
  const status = "status" in fields && typeof fields.status === "number" && fields.status >= 400 && fields.status < 600
    ? fields.status
    : 500;
  return {
    status,
    body: { jsonrpc: "2.0", error: parse ? { code: -32700, message: "Parse error" } : { code: -32603, message: "Internal error" }, id: null },
  };
}

// What the handler needs of Express's request and response, so a test can pass plain objects.
interface MinimalResponse {
  headersSent: boolean;
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Express error handler (four parameters) answering with requestErrorAnswer().
 * Once a streamed answer has started, Express ends it. `onError` hears about
 * every error with the status it is answered with (the caller decides what to log).
 */
export function jsonRpcRequestErrors(
  onError?: (status: number, error: unknown) => void,
): (error: unknown, req: unknown, res: MinimalResponse, next: (error: unknown) => void) => void {
  return (error, _req, res, next) => {
    const { status, body } = requestErrorAnswer(error);
    onError?.(status, error);
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(status).json(body);
  };
}
