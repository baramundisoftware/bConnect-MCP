/**
 * Request errors on the HTTP transports (REQ-GW-004): the gateway and every
 * server's HTTP mode answer a body that can't be read, or a handler that
 * fails, with a JSON-RPC error — never Express's HTML page, never the error's
 * own message.
 */
import { describe, expect, it } from 'vitest';
import { jsonRpcRequestErrors, requestErrorAnswer } from '../packages/mcp-core/src/request-errors.js';

/** An error as Express's body parser raises it (http-errors: status + type). */
function bodyError(status: number, type: string, message = `secret detail at /srv/app/node_modules/x.js (${type})`) {
  return Object.assign(new Error(message), { status, statusCode: status, type, expose: true });
}

const PARSE_ERROR = { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null };
const INTERNAL_ERROR = { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null };

describe('requestErrorAnswer', () => {
  it('malformed JSON → 400, JSON-RPC parse error', () => {
    expect(requestErrorAnswer(bodyError(400, 'entity.parse.failed'))).toEqual({ status: 400, body: PARSE_ERROR });
  });

  it('a body over the limit → 413, JSON-RPC internal error', () => {
    expect(requestErrorAnswer(bodyError(413, 'entity.too.large'))).toEqual({ status: 413, body: INTERNAL_ERROR });
  });

  it.each([
    [415, 'charset.unsupported'],
    [415, 'encoding.unsupported'],
    [400, 'request.aborted'],
    [400, 'request.size.invalid'],
  ])('any other body error keeps its status %i (%s), JSON-RPC internal error', (status, type) => {
    expect(requestErrorAnswer(bodyError(status, type))).toEqual({ status, body: INTERNAL_ERROR });
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['a thrown string', 'boom'],
    ['undefined', undefined],
    ['null', null],
    ['a status below 400', { status: 302 }],
    ['a status of 600 or more', { status: 600 }],
    ['a status that is no number', { status: '404' }],
    ['a type that is no string', { type: 42 }],
  ])('%s → 500, JSON-RPC internal error', (_name, error) => {
    expect(requestErrorAnswer(error)).toEqual({ status: 500, body: INTERNAL_ERROR });
  });

  it('a parse-error type without a status still answers 500 (the status comes only from the error)', () => {
    expect(requestErrorAnswer({ type: 'entity.parse.failed' })).toEqual({ status: 500, body: PARSE_ERROR });
  });

  it("never carries the error's message, a stack or a path", () => {
    const text = JSON.stringify(requestErrorAnswer(bodyError(400, 'entity.parse.failed')));
    expect(text).not.toMatch(/secret|node_modules|\/srv\/|stack/i);
  });
});

/** A response that records what the handler did. */
function recorder(headersSent = false) {
  const seen: { status?: number; body?: unknown; next?: unknown } = {};
  const res = {
    headersSent,
    status(code: number) {
      seen.status = code;
      return { json(body: unknown) { seen.body = body; } };
    },
  };
  return { res, seen, next: (error: unknown) => { seen.next = error; } };
}

describe('jsonRpcRequestErrors', () => {
  it('is an Express error handler (four parameters)', () => {
    expect(jsonRpcRequestErrors()).toHaveLength(4);
  });

  it('answers with the status and JSON-RPC body of requestErrorAnswer', () => {
    const { res, seen, next } = recorder();
    jsonRpcRequestErrors()(bodyError(400, 'entity.parse.failed'), {}, res, next);
    expect(seen).toEqual({ status: 400, body: PARSE_ERROR });
  });

  it('leaves an answer whose streaming has started to Express', () => {
    const error = new Error('late');
    const { res, seen, next } = recorder(true);
    jsonRpcRequestErrors()(error, {}, res, next);
    expect(seen).toEqual({ next: error });
  });
});
