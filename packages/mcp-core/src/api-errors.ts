/**
 * Typed errors of the shared client (REQ-XC-001, ADR-0008 D1).
 *
 * `message` keeps the short operator text the audit log and the startup probe
 * have always shown. `toolErrorResult()` builds the model-facing text from the
 * fields instead.
 */

export interface BConnectApiErrorDetails {
  status: number;
  method: string;       // upper-case HTTP method
  path: string;         // request path relative to the base URL, without the query string
  problemText?: string; // bConnect's problem title/detail/errors, already cleaned and shortened
}

/** bConnect answered with an HTTP error status. */
export class BConnectApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly problemText?: string;

  constructor(message: string, details: BConnectApiErrorDetails) {
    super(message);
    this.name = "BConnectApiError";
    this.status = details.status;
    this.method = details.method;
    this.path = details.path;
    this.problemText = details.problemText;
  }
}

/** The request was sent but no answer came back (network, DNS, TLS). */
export class BConnectConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BConnectConnectionError";
  }
}
