/**
 * Request-body validation against the OpenAPI specs, for the spec-conformance
 * guard (REQ-QA-001 AC 4).
 *
 * This module picks the content type and parses the body; the schema check is
 * the shared spec validator (`spec-validator.ts`), which handles the OpenAPI
 * 3.0 patterns JSON Schema reads differently.
 *
 * JSON Patch bodies (`application/json-patch+json`) are checked against the
 * JSON Patch format (RFC 6902): an array of operations with a known `op` and a
 * `path` starting with "/". The specs type each operation's `value` as an
 * object, which a valid patch replacing a string or number would fail; that is
 * a generator artefact, not the API contract.
 */
import { type ApiOperation, type Release, type Schema } from './spec.js';
import { specValidator } from './spec-validator.js';

export const JSON_PATCH = 'application/json-patch+json';

const PATCH_OPS = /^(add|remove|replace|move|copy|test)$/i;

/** Problems with a JSON Patch document; empty when it is well-formed. */
export function jsonPatchProblems(data: unknown): string[] {
  if (!Array.isArray(data)) return ['not a JSON Patch array'];
  return data.flatMap((op: Schema, i: number) => {
    if (!op || typeof op !== 'object') return [`/${i} is not an operation`];
    const problems: string[] = [];
    if (!PATCH_OPS.test(String(op.op))) problems.push(`/${i}/op is not a JSON Patch operation`);
    if (typeof op.path !== 'string' || !op.path.startsWith('/')) problems.push(`/${i}/path must start with "/"`);
    return problems;
  });
}

/** Validators for one release. */
export type BodyValidator = (op: ApiOperation, contentType: string, body: string, options?: { ignoreFormats?: boolean }) => string[];

export function bodyValidator(release: Release): BodyValidator {
  const spec = specValidator(release);

  /**
   * Problems with a request body; empty when it is valid. `ignoreFormats` drops
   * `format` errors (for calls whose argument values are the guard's samples).
   */
  return (op, contentType, body, options = {}) => {
    const declared = Object.keys(op.requestBodies);
    if (body === '' && !op.bodyRequired) return [];
    // Validate against the declared type that matches, or the operation's first declared type.
    const type = declared.includes(contentType) ? contentType : declared[0];
    let data: unknown;
    try {
      data = body === '' ? undefined : JSON.parse(body);
    } catch {
      return ['body is not JSON'];
    }
    if (type === JSON_PATCH) return jsonPatchProblems(data);
    return spec.body(op, type, data, options);
  };
}
