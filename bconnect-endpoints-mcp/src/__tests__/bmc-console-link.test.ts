/**
 * Unit tests for the bMC console link builder (LOCAL ADDITION).
 *
 * These test the pure string-building logic only — they do not, and cannot,
 * confirm that bMC itself resolves the resulting URIs. That is a manual step on
 * a machine with the console installed, and the reason the whole block is
 * opt-in rather than on by default.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildConsoleLink,
  buildRemoteDeskLink,
  consoleLinkMeta,
  withConsoleLinkMeta,
  CONSOLE_LINK_TEMPLATE,
  NAVIGATION_OBJECT_TYPE_MAP,
  DEFAULT_CRITERIA_TYPE,
  isConsoleLinksEnabled,
  isRemoteDeskLinksEnabled,
  mapNavigationObjectType,
} from '../modules/bmc-console-link.js';

const WORKSTATION1 = {
  id: 'e57a7e00-0000-4000-8000-000000000027',
  type: 'WindowsEndpoint',
  displayName: 'WORKSTATION1',
  hostName: 'WORKSTATION1',
};

/**
 * Expand the response-level template the way a consumer is told to — this is
 * the reader half of TOK-23, written out so the tests below prove the template
 * is LOSSLESS rather than merely present.
 */
function expandTemplate(
  template: string,
  objectType: Readonly<Record<string, string>>,
  row: { id?: string; type?: string }
): string {
  const mapped = row.type ? objectType[row.type] : undefined;
  const base = mapped
    ? template
    : template.replace('%20/navigationObjectType={objectType}', '');
  return base
    .replace('{id}', encodeURIComponent(row.id ?? ''))
    .replace('{objectType}', mapped ?? '');
}

describe('DEFAULT_CRITERIA_TYPE', () => {
  it('defaults to Id', () => {
    expect(DEFAULT_CRITERIA_TYPE).toBe('Id');
  });
});

describe('mapNavigationObjectType', () => {
  it('maps documented Windows/Mac/Android types straight through', () => {
    expect(mapNavigationObjectType('WindowsEndpoint')).toBe('WindowsEndpoint');
    expect(mapNavigationObjectType('MacEndpoint')).toBe('MacEndpoint');
    expect(mapNavigationObjectType('AndroidEndpoint')).toBe('AndroidEndpoint');
  });

  it('re-cases the API\'s IOSEndpoint to bMC\'s documented IosEndpoint', () => {
    expect(mapNavigationObjectType('IOSEndpoint')).toBe('IosEndpoint');
  });

  it('returns undefined for platforms with no documented navigationObjectType', () => {
    expect(mapNavigationObjectType('LinuxEndpoint')).toBeUndefined();
    expect(mapNavigationObjectType('NetworkEndpoint')).toBeUndefined();
    expect(mapNavigationObjectType('IndustrialEndpoint')).toBeUndefined();
  });

  it('returns undefined for missing/unrecognised type', () => {
    expect(mapNavigationObjectType(undefined)).toBeUndefined();
    expect(mapNavigationObjectType(null)).toBeUndefined();
    expect(mapNavigationObjectType('SomethingNew')).toBeUndefined();
  });
});

describe('buildConsoleLink', () => {
  it('defaults to Id and omits the trailing space/slash encoding correctly', () => {
    const link = buildConsoleLink(WORKSTATION1);
    expect(link).toBe(
      'bMC:///navigationCriteria=e57a7e00-0000-4000-8000-000000000027%20/navigationCriteriaType=Id%20/navigationObjectType=WindowsEndpoint'
    );
  });

  it('builds a Hostname link with no navigationObjectType for an untyped platform', () => {
    const link = buildConsoleLink(
      { id: 'x', hostName: 'LINUX1', type: 'LinuxEndpoint' },
      { criteriaType: 'Hostname' }
    );
    expect(link).toBe('bMC:///navigationCriteria=LINUX1%20/navigationCriteriaType=Hostname');
  });

  it('percent-encodes a value that itself contains spaces and colons', () => {
    const link = buildConsoleLink(
      { displayName: 'Network device 00:0C:29:4C:7D:2F', type: 'NetworkEndpoint' },
      { criteriaType: 'Name' }
    );
    expect(link).toContain(encodeURIComponent('Network device 00:0C:29:4C:7D:2F'));
    expect(link).not.toMatch(/ /); // no literal space anywhere in the URI
  });

  it('returns null when the chosen criteriaType has no backing field', () => {
    expect(buildConsoleLink({ id: 'x' }, { criteriaType: 'Hostname' })).toBeNull();
    expect(buildConsoleLink({ hostName: 'H' }, { criteriaType: 'Id' })).toBeNull();
    expect(buildConsoleLink({})).toBeNull();
  });
});

describe('buildRemoteDeskLink', () => {
  it('prefers hostName, falls back to displayName', () => {
    expect(buildRemoteDeskLink({ hostName: 'WORKSTATION1', displayName: 'ignored' })).toBe(
      'bmc:///remotedesk=WORKSTATION1'
    );
    expect(buildRemoteDeskLink({ displayName: 'Only A Name' })).toBe(
      `bmc:///remotedesk=${encodeURIComponent('Only A Name')}`
    );
  });

  it('returns null with neither field', () => {
    expect(buildRemoteDeskLink({})).toBeNull();
  });
});

describe('isRemoteDeskLinksEnabled / env gating', () => {
  const ENV_VAR = 'BMC_REMOTEDESK_LINKS';
  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it('is false by default (unset)', () => {
    delete process.env[ENV_VAR];
    expect(isRemoteDeskLinksEnabled()).toBe(false);
  });

  it('is false for any value other than the literal string "true"', () => {
    process.env[ENV_VAR] = '1';
    expect(isRemoteDeskLinksEnabled()).toBe(false);
    process.env[ENV_VAR] = 'True';
    expect(isRemoteDeskLinksEnabled()).toBe(false);
  });

  it('is true only when set to exactly "true"', () => {
    process.env[ENV_VAR] = 'true';
    expect(isRemoteDeskLinksEnabled()).toBe(true);
  });
});

// ── TOK-23 — the template replaces the per-row string ──────────────────────

describe('consoleLinkMeta', () => {
  it('reproduces buildConsoleLink() exactly for a typed row — the template is lossless', () => {
    const meta = consoleLinkMeta(WORKSTATION1, false);
    expect(expandTemplate(meta.template, meta.objectType, WORKSTATION1)).toBe(
      buildConsoleLink(WORKSTATION1)
    );
  });

  it('reproduces it for an untyped platform too, by dropping the objectType segment', () => {
    // Linux/Network/Industrial have no documented navigationObjectType, so the
    // per-row builder omits the parameter. A template that could not express
    // that would be lossy for three of this estate's platforms.
    const linux = { id: 'e57a7e00-0000-4000-8000-000000000032', type: 'LinuxEndpoint' };
    const meta = consoleLinkMeta(linux, false);
    expect(expandTemplate(meta.template, meta.objectType, linux)).toBe(buildConsoleLink(linux));
    expect(meta.objectType).not.toHaveProperty('LinuxEndpoint');
  });

  it('carries one fully-expanded example so a human can copy-paste without substituting', () => {
    // The first thing anyone does with this block is paste one link straight
    // out of a tool result into the console. A bare template would make that a
    // substitution exercise.
    expect(consoleLinkMeta(WORKSTATION1, false).example).toBe(buildConsoleLink(WORKSTATION1));
  });

  it('emits the template and the type table but no example for an empty page', () => {
    const meta = consoleLinkMeta(undefined, false);
    expect(meta.template).toBe(CONSOLE_LINK_TEMPLATE);
    expect(meta.objectType).toEqual(NAVIGATION_OBJECT_TYPE_MAP);
    expect(meta.example).toBeUndefined();
  });

  it('says remote-control links are off by default, and emits no remoteDesk template', () => {
    const meta = consoleLinkMeta(WORKSTATION1, false);
    expect(meta.remoteDeskLinksEnabled).toBeUndefined();
    expect(meta.remoteDeskTemplate).toBeUndefined();
    expect(meta.note).not.toContain('AnyDesk');
  });

  /**
   * SUITE-01/02 in one assertion. The note is prose a model relays verbatim to
   * an operator, so it may not send them after a file that is not in the
   * product, and it may not describe an unconfirmed URI scheme as if it were
   * confirmed. Both branches are checked because the RemoteDesk branch is the
   * one that gets edited least often.
   */
  it.each([[false], [true]])(
    'note points at no document and does not overclaim (includeRemoteDesk=%s)',
    (remoteDesk) => {
      const note = consoleLinkMeta(WORKSTATION1, remoteDesk).note;
      expect(note).not.toMatch(/\.md\b/i);
      expect(note).toMatch(/has not been confirmed/i);
      expect(note).toContain('BMC_CONSOLE_LINKS');
    }
  );
});

describe('isConsoleLinksEnabled / the outer gate', () => {
  const ENV_VAR = 'BMC_CONSOLE_LINKS';
  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it('is false by default (unset)', () => {
    delete process.env[ENV_VAR];
    expect(isConsoleLinksEnabled()).toBe(false);
  });

  it('is false for any value other than the literal string "true"', () => {
    process.env[ENV_VAR] = '1';
    expect(isConsoleLinksEnabled()).toBe(false);
    process.env[ENV_VAR] = 'True';
    expect(isConsoleLinksEnabled()).toBe(false);
  });

  it('is true only when set to exactly "true"', () => {
    process.env[ENV_VAR] = 'true';
    expect(isConsoleLinksEnabled()).toBe(true);
  });

  it('withConsoleLinkMeta attaches nothing while the gate is shut', () => {
    delete process.env[ENV_VAR];
    const linked = withConsoleLinkMeta({ data: [WORKSTATION1], totalItems: 1 });
    expect(linked).not.toHaveProperty('consoleLinks');
    expect(linked.totalItems).toBe(1);
    expect(linked.data[0]).toEqual(WORKSTATION1);
  });

  it('withConsoleLinkMeta attaches the block once the env var is set', () => {
    process.env[ENV_VAR] = 'true';
    const linked = withConsoleLinkMeta({ data: [WORKSTATION1] });
    expect(linked.consoleLinks?.template).toBe(CONSOLE_LINK_TEMPLATE);
  });

  it('the RemoteDesk flag alone does not open this gate', () => {
    // RemoteDesk lives inside consoleLinks, so the stricter gate has to win —
    // otherwise setting the remote-control flag would silently re-enable the
    // navigation links it is nested in.
    delete process.env[ENV_VAR];
    process.env.BMC_REMOTEDESK_LINKS = 'true';
    try {
      expect(withConsoleLinkMeta({ data: [WORKSTATION1] })).not.toHaveProperty('consoleLinks');
    } finally {
      delete process.env.BMC_REMOTEDESK_LINKS;
    }
  });

  it('emits the remoteDesk template and example only when enabled', () => {
    const meta = consoleLinkMeta(WORKSTATION1, true);
    expect(meta.remoteDeskLinksEnabled).toBe(true);
    expect(meta.remoteDeskTemplate).toBe('bmc:///remotedesk={hostName}');
    expect(meta.remoteDeskExample).toBe(buildRemoteDeskLink(WORKSTATION1));
    expect(meta.note).toContain('AnyDesk');
  });
});

// Every case below opts the gate open explicitly — these are about the SHAPE
// the block takes once a customer has asked for it, not about whether it is on.
describe('withConsoleLinkMeta', () => {
  it('is additive: preserves every existing top-level field of a paged response', () => {
    const raw = {
      currentPage: 0,
      pageSize: 30,
      totalPages: 1,
      totalItems: 1,
      hasPreviousPage: false,
      hasNextPage: false,
      data: [WORKSTATION1],
    };
    const linked = withConsoleLinkMeta(raw, { includeConsoleLinks: true, includeRemoteDesk: false });
    expect(linked.currentPage).toBe(0);
    expect(linked.totalItems).toBe(1);
    expect(linked.hasNextPage).toBe(false);
    expect(linked.consoleLinks!.template).toBe(CONSOLE_LINK_TEMPLATE);
  });

  it('leaves the rows untouched — that is the whole change', () => {
    const raw = { data: [{ ...WORKSTATION1 }] };
    const linked = withConsoleLinkMeta(raw, { includeConsoleLinks: true, includeRemoteDesk: false });
    expect(linked.data[0]).not.toHaveProperty('consoleLink');
    expect(linked.data[0]).not.toHaveProperty('remoteDeskLink');
    expect(linked.data[0]).toEqual(WORKSTATION1);
  });

  it('does not mutate the input', () => {
    const raw = { data: [{ ...WORKSTATION1 }] };
    withConsoleLinkMeta(raw, { includeConsoleLinks: true, includeRemoteDesk: false });
    expect(raw).not.toHaveProperty('consoleLinks');
  });

  it('handles a response with no data array without throwing', () => {
    const linked = withConsoleLinkMeta({ totalItems: 0 }, { includeConsoleLinks: true, includeRemoteDesk: false });
    expect(linked.consoleLinks!.example).toBeUndefined();
    expect(linked.totalItems).toBe(0);
  });

  it('costs less than the per-row links it replaces on any page above three rows', () => {
    // The measurement TOK-23 rests on, as an assertion rather than a claim.
    const rows = Array.from({ length: 20 }, (_unused, i) => ({
      ...WORKSTATION1,
      id: `9dd53b61-888b-42c4-bd1a-9b8dae00${String(i).padStart(4, '0')}`,
    }));

    // What the old attachConsoleLinksToListResponse produced: a URI per row
    // plus a ~340-character note, reconstructed here so the comparison is
    // against the real previous output and not a guess at it.
    const oldShape = {
      data: rows.map((r) => ({ ...r, consoleLink: buildConsoleLink(r) })),
      consoleLinksInfo: {
        note:
          `consoleLink opens this endpoint in the baramundi Management Center (bMC:/// URI, default ` +
          `navigationCriteriaType=Id — unconfirmed end to end, see BMC-CONSOLE-LINKS.md). ` +
          `Set BMC_REMOTEDESK_LINKS=true on this server to also emit remoteDeskLink (live remote-control, a ` +
          `different risk class — off by default).`,
      },
    };
    const newShape = withConsoleLinkMeta({ data: rows }, { includeConsoleLinks: true, includeRemoteDesk: false });

    const oldBytes = Buffer.byteLength(JSON.stringify(oldShape), 'utf8');
    const newBytes = Buffer.byteLength(JSON.stringify(newShape), 'utf8');

    expect(newBytes).toBeLessThan(oldBytes);
    // Sanity floor: the saving is thousands of bytes on a default page, not tens.
    expect(oldBytes - newBytes).toBeGreaterThan(2000);
  });
});
