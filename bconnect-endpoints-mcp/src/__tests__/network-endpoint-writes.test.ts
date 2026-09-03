/**
 * The restored network-endpoint write fields.
 *
 * ── What was lost, and why ──────────────────────────────────────────────────
 * The 2026-08-02 family collapse dropped `updateData`, an untyped blob that
 * was itself a defect — and took the legitimate half with it. A network
 * endpoint was left editable only in `displayName`, `comment` and `hostName`:
 * the three fields it shares with every other endpoint type, and none of the
 * ones that make it a NETWORK endpoint.
 *
 * ── Where the field list comes from ─────────────────────────────────────────
 * The 26R1 PATCH /v2.0/NetworkEndpoints/{id} request-body example, and nothing
 * else. That is not a stylistic preference: the OpenAPI schema marks nothing
 * `readOnly`, so the response model is no guide at all to what may be written,
 * and the request-body example is the only statement of writability the spec
 * makes. Inventing a path it does not document is how the `emailRecipient`
 * defect happened.
 *
 * The example, verbatim:
 *   /displayName /comment /hostName /primaryIP /primaryMAC /registeredUser
 *   /webInterfaceUrl /sshConfiguration/Port /snmpConfiguration
 *
 * Note `/sshConfiguration/Port` — a SUB-PATH. The vendor never replaces
 * `sshConfiguration` whole, so neither does this suite.
 *
 * NOT verified against a live network endpoint. The standing rule permits
 * writes to WORKSTATION1 only, which is a Windows endpoint, so these assert
 * the patch document this suite BUILDS matches the vendor's example — not
 * that the server accepted one.
 */
import { describe, it, expect } from 'vitest';
import { buildPatchDocument, updatableFieldsFor } from '../endpoint-types.js';
import { isSensitiveParameterName, redactSensitiveParameters } from '@bconnect/mcp-core';

describe('a network endpoint is editable in the fields that make it one', () => {
  const fields = updatableFieldsFor('NetworkEndpoint');

  it('restores every field the 26R1 patch example writes', () => {
    for (const field of [
      'primaryIP',
      'primaryMAC',
      'registeredUser',
      'webInterfaceUrl',
      'sshConfigurationPort',
      'snmpConfiguration',
    ]) {
      expect(fields, `${field} is missing from the NetworkEndpoint updatable set`).toContain(field);
    }
    // The three it always had.
    expect(fields).toContain('displayName');
    expect(fields).toContain('comment');
    expect(fields).toContain('hostName');
  });

  it('still refuses logicalGroupId, which the vendor example does not carry', () => {
    // The collapse's own reasoning, kept: the NetworkEndpoints patch example
    // has no logicalGroupId, and adding one would be inventing a path.
    expect(fields).not.toContain('logicalGroupId');
  });

  it('builds the exact paths the vendor example uses', () => {
    const patch = buildPatchDocument(
      {
        primaryIP: '10.10.5.101',
        primaryMAC: 'AA:BB:CC:DD:EE:FF',
        registeredUser: 'user@development.dev',
        webInterfaceUrl: 'https://www.baramundi.com',
        sshConfigurationPort: 666,
      },
      fields
    );
    const paths = patch.map((op) => op.path);
    expect(paths).toEqual([
      '/primaryIP',
      '/primaryMAC',
      '/registeredUser',
      '/webInterfaceUrl',
      // The sub-path, NOT /sshConfiguration. This is the whole reason
      // sshConfigurationPort is a distinct argument name.
      '/sshConfiguration/Port',
    ]);
    expect(patch.every((op) => op.op === 'replace')).toBe(true);
  });

  it('never emits a whole-object replace of sshConfiguration', () => {
    // A whole-object replace is not demonstrated by the spec, so the suite
    // must not be able to produce one by any argument it accepts.
    const patch = buildPatchDocument({ sshConfigurationPort: 22 }, fields);
    expect(patch.map((op) => op.path)).not.toContain('/sshConfiguration');
  });

  it('omits fields the caller did not pass, rather than nulling them', () => {
    const patch = buildPatchDocument({ primaryIP: '10.0.0.1' }, fields);
    expect(patch).toEqual([{ op: 'replace', path: '/primaryIP', value: '10.0.0.1' }]);
  });
});

describe('the SNMP configuration carries credentials, and they are redacted', () => {
  it('recognises every secret-bearing field in the object', () => {
    // v3 uses two passwords; v1/v2c uses the community string, which IS the
    // credential and merely is not spelled "password".
    for (const name of ['authenticationPassword', 'encryptionPassword', 'community']) {
      expect(isSensitiveParameterName(name), `${name} must be treated as sensitive`).toBe(true);
    }
    // Not everything in the object is a secret — over-redacting an audit log
    // until it says nothing is its own failure.
    for (const name of ['version', 'username', 'contextName', 'authentication']) {
      expect(isSensitiveParameterName(name)).toBe(false);
    }
  });

  it('redacts them out of an audit record of a real patch', () => {
    const patch = buildPatchDocument(
      {
        snmpConfiguration: {
          version: 'V3',
          community: 'public-but-actually-secret',
          username: 'snmpuser',
          authentication: 'SHA256',
          authenticationPassword: 'super-secret-auth',
          encryptionPassword: 'super-secret-enc',
        },
      },
      updatableFieldsFor('NetworkEndpoint')
    );
    const audited = JSON.stringify(redactSensitiveParameters({ patchOperations: patch }));

    for (const secret of ['super-secret-auth', 'super-secret-enc', 'public-but-actually-secret']) {
      expect(audited, `${secret} reached the audit record`).not.toContain(secret);
    }

    // The consequence, recorded rather than smoothed over. A JSON Patch body
    // nests root -> patchOperations[] -> {op,path,value} -> the value object,
    // which is REDACT_MAX_DEPTH, so the non-secret fields come back
    // `[depth-limited]` too. The audit record for an SNMP patch is therefore
    // ATTRIBUTABLE but not DESCRIPTIVE: it shows that /snmpConfiguration was
    // replaced, by whom and when, and not what it was set to.
    //
    // That is the depth cap failing CLOSED, which is the behaviour we want —
    // an unknown-shaped object is redacted rather than walked. Raising the cap
    // to make this record prettier would loosen a control on every other
    // payload in the suite, so it is left alone and written down instead.
    expect(audited).toContain('/snmpConfiguration');
    expect(audited).toContain('depth-limited');
    expect(audited).not.toContain('V3');
  });
});
