/**
 * What the live bMS can and cannot show. A tool whose data class the bMS lacks
 * returns empty lists or has no ID to call with: that is "not verified live",
 * never a pass.
 *
 * Endpoint types are counted from the list answers (totalItems). MDM and Entra ID
 * can't be read from the API; the env file declares them (BCONNECT_LIVE_MDM,
 * BCONNECT_LIVE_ENTRA_ID = yes|no), and undeclared counts as absent.
 */
import type { ToolRun } from './report.js';

export type Declared = 'yes' | 'no' | 'not declared';

export interface Profile {
  release: string;
  bmsVersion?: string;
  /**
   * Endpoint type (Windows, Linux, Mac, Android, Ios, …) → totalItems of its list, and
   * how many of the listed items are enrolled (managementState other than Enrollable).
   * A type counts as present only with an enrolled endpoint: an Enrollable record has
   * no device behind it.
   */
  endpointTypes: Record<string, { total: number; enrolled: number }>;
  mdm: Declared;
  entraId: Declared;
  /** Releases the tier supports but this run did not test. */
  untestedReleases: string[];
}

export function declared(value: string | undefined): Declared {
  const v = value?.trim().toLowerCase();
  return v === 'yes' || v === 'no' ? v : 'not declared';
}

function isEnrolled(item: unknown): boolean {
  if (typeof item !== 'object' || item === null || !('managementState' in item)) return true;
  return item.managementState !== 'Enrollable';
}

/** Endpoint counts from list answers of `/v2.0/<Type>Endpoints` in the endpoints API. */
export function endpointTypesFrom(answers: Array<{ domain: string; path: string; body: unknown }>): Profile['endpointTypes'] {
  const types: Profile['endpointTypes'] = {};
  for (const a of answers) {
    const m = a.domain === 'endpoints' ? /^\/v2\.0\/(\w+)Endpoints$/.exec(a.path) : null;
    if (!m || typeof a.body !== 'object' || a.body === null || !('totalItems' in a.body) || !('data' in a.body)) continue;
    const { totalItems, data } = a.body;
    if (typeof totalItems !== 'number' || !Array.isArray(data)) continue;
    types[m[1]] = { total: totalItems, enrolled: data.filter(isEnrolled).length };
  }
  return types;
}

interface DataClass { name: string; route: RegExp; present(p: Profile): boolean }

const endpointType = (type: string) => (p: Profile): boolean => (p.endpointTypes[type]?.enrolled ?? 0) > 0;

/** Data classes by the route of the tool's operation (`<domain> <spec path>`). */
const DATA_CLASSES: DataClass[] = [
  { name: 'Android endpoints', route: /^endpoints .*AndroidEndpoints/, present: endpointType('Android') },
  { name: 'iOS endpoints', route: /^endpoints .*IosEndpoints/, present: endpointType('Ios') },
  { name: 'Mac endpoints', route: /^endpoints .*MacEndpoints/, present: endpointType('Mac') },
  { name: 'MDM (enrollment, mobile device rules)', route: /^(endpoints .*\/StartEnrollment$|compliance \/v2\.0\/(Rules|DetectedRuleViolations)\b)/, present: (p) => p.mdm === 'yes' },
  { name: 'Entra ID', route: /^endpoints .*EntraIdData/, present: (p) => p.entraId === 'yes' },
];

/** The data class a route belongs to that this bMS lacks, if any. */
export function missingClass(route: string, profile: Profile): string | undefined {
  return DATA_CLASSES.find((c) => c.route.test(route) && !c.present(profile))?.name;
}

/** Runs of tools whose data class is missing become "not verified live"; failures stay failures. */
export function classifyByProfile(runs: ToolRun[], profile: Profile): ToolRun[] {
  return runs.map((run) => {
    if (run.outcome === 'failed' || !run.route) return run;
    const missing = missingClass(run.route, profile);
    return missing ? { ...run, outcome: 'not verified live', detail: `no ${missing} on this bMS` } : run;
  });
}
