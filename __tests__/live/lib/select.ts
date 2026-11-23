/**
 * Which tools the live tier may call: only those whose declared operations
 * (`<server>/src/operations.ts`) are all GETs in the release's spec that return
 * no credentials, and that aren't behind ALLOW_SECRET_READ for another reason (the
 * API key reads: their description says so). The live run keeps that gate closed.
 * Anything else is skipped with the reason.
 */
import { operationIn } from '../../lib/conformance.js';
import { domainOf } from '../../lib/exerciser.js';
import { loadOperations, type ApiOperation, type Release } from '../../lib/spec.js';

/** The operations a tool declares, or why it is not exercised here. */
export function readOperations(release: Release, server: string, table: Readonly<Record<string, readonly string[]>>, tool: string, description = ''): ApiOperation[] | string {
  const ids = Object.hasOwn(table, tool) ? table[tool] : undefined;
  if (!ids?.length) {return 'no operation declared';}
  // In the server's own spec, as the conformance guard does: operationIds such as GetFolder recur across specs.
  const ops = ids.map((id) => operationIn(loadOperations(release), domainOf(server), id))
    .filter((op): op is ApiOperation => op !== undefined);
  if (ops.length !== ids.length) {return `operation not in the ${release} spec`;}
  if (ops.some((op) => op.method !== 'GET')) {return 'write tool';}
  if (ops.some((op) => op.secretFields.length > 0)) {return 'returns credentials (secret gate)';}
  if (description.includes('Needs ALLOW_SECRET_READ=true')) {return 'behind ALLOW_SECRET_READ (secret gate)';}
  return ops;
}
