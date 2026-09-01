/**
 * The declaration layer (OPT-31).
 *
 * Two claims are under test and they are different claims.
 *
 * The first is that the derivation is *correct against the real 26R1 specs* —
 * not against a fixture that agrees with the code by construction. Every
 * derivation test below runs on `openapi-specs/26R1/bConnect_Compliance.json`
 * and `bConnect_Jobs.json` as shipped, so a vendor change to a route breaks the
 * test rather than the catalogue.
 *
 * The second is that the layer *refuses* rather than guesses. bConnect answers
 * HTTP 200 and silently drops a query parameter it does not recognise (finding
 * D6), so a schema that over-advertises returns a confident wrong answer with no
 * error anywhere. Half the tests here assert a `throw`, and each one names the
 * shipped bug class it closes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildOperationIndex,
  requireOperation,
  serializeOperationIndex,
  deserializeOperationIndex,
  defineTools,
  composite,
  defineToolCatalogue,
  objectSchema,
  guidProperty,
  PAGE_DESCRIPTION,
  PAGE_SIZE_DESCRIPTION,
  ORDER_BY_DESCRIPTION,
  DERIVED_DESCRIPTION_LIMIT,
  type OperationIndex,
} from '@bconnect/mcp-core';

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'openapi-specs', '26R1');

function loadSpec(file: string): unknown {
  return JSON.parse(readFileSync(join(SPEC_DIR, file), 'utf8'));
}

const complianceSpec = loadSpec('bConnect_Compliance.json');
const jobsSpec = loadSpec('bConnect_Jobs.json');

const compliance = buildOperationIndex(complianceSpec, 'compliance');
const jobs = buildOperationIndex(jobsSpec, 'jobs');

// ─────────────────────────────────────────────────────────────────────────────

describe('operation index: the runtime facts src/generated/*-types.ts erases', () => {
  it('indexes every operation in the shipped 26R1 compliance spec', () => {
    // 8 paths, one GET each.
    expect(Object.keys(compliance.operations)).toHaveLength(8);
    expect(compliance.operations.GetVulnerability).toBeDefined();
  });

  it('carries route, verb and typed parameters', () => {
    const op = requireOperation(compliance, 'GetDetectedRuleViolationsForEndpoint');
    expect(op.method).toBe('get');
    expect(op.path).toBe('/v2.0/Endpoints/{endpointId}/DetectedRuleViolations');

    const byName = Object.fromEntries(op.parameters.map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(['OrderBy', 'Page', 'PageSize', 'SearchQuery', 'endpointId']);
    // integer → number: the suite's schemas have always advertised "number",
    // and MCP clients send JSON numbers. `format` keeps the distinction.
    expect(byName.Page).toMatchObject({ in: 'query', type: 'number', format: 'int32', required: false });
    expect(byName.endpointId).toMatchObject({ in: 'path', type: 'string', format: 'guid', required: true });
  });

  it('flattens the allOf-around-a-$ref that wraps every bConnect request body', () => {
    // Every write body in these specs is `allOf: [{ $ref: ... }]`. A resolver
    // that does not flatten allOf finds no properties and derives an EMPTY
    // body — a create tool that advertises nothing and 400s on every call.
    const op = requireOperation(jobs, 'CreateFolder');
    expect(op.method).toBe('post');
    expect(op.body).toBeDefined();
    expect(op.body!.contentType).toBe('application/json');
    expect(op.body!.fields.map((f) => f.name).sort()).toEqual(['comment', 'name', 'parentId']);
    expect(op.body!.isArray).toBe(false);
  });

  it('flags a non-object body instead of deriving nonsense from it', () => {
    // UpdateFolder takes a JSON Patch document: an ARRAY of operations, not an
    // object with fields. `isArray` is how the declaration layer knows to leave
    // it to a hand-authored schema rather than advertise zero fields.
    const op = requireOperation(jobs, 'UpdateFolder');
    expect(op.body!.contentType).toBe('application/json-patch+json');
    expect(op.body!.isArray).toBe(true);
  });

  it('round-trips through JSON, so a build step can ship the index not the spec', () => {
    // The twelve 26R1 specs are 1.09 MB; nothing should load that at runtime.
    const round = deserializeOperationIndex(serializeOperationIndex(compliance));
    expect(round).toEqual(compliance);
    expect(serializeOperationIndex(compliance).length).toBeLessThan(
      JSON.stringify(complianceSpec).length / 2
    );
  });

  it('names the module and the operation when a route is gone', () => {
    // The live case: 26R1 deletes IndustrialEndpoints — 8 operations, 3
    // schemas — while the suite still ships 5 industrial tools. Declaring
    // against a removed operation must fail at construction, in a test, not as
    // a 404 the first time an operator calls it.
    expect(() => requireOperation(compliance, 'GetIndustrialEndpoint')).toThrow(
      /compliance: no operation "GetIndustrialEndpoint"/
    );
  });

  it('refuses a document with no paths', () => {
    expect(() => buildOperationIndex({ openapi: '3.0.4' }, 'broken')).toThrow(/no `paths` object/);
  });

  it('refuses two operations sharing an operationId', () => {
    const doc = {
      paths: {
        '/a': { get: { operationId: 'Same', parameters: [] } },
        '/b': { get: { operationId: 'Same', parameters: [] } },
      },
    };
    expect(() => buildOperationIndex(doc, 'dup')).toThrow(/duplicate operationId\(s\): Same/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('defineTools derives the tools/list entry', () => {
  const declared = defineTools(
    compliance,
    {
      list_detected_rule_violations: {
        op: 'GetDetectedRuleViolations',
        description: 'List detected compliance rule violations across Android, iOS and macOS endpoints.',
        shaping: ['countOnly'],
      },
      get_mobile_device_rule: {
        op: 'GetMobileDeviceRule',
        description: 'Get one mobile-device compliance rule by id.',
      },
    }
  );

  it('writes the hand-authored description through verbatim', () => {
    // 28.1% of the default catalogue is descriptions and none of it is
    // derivable — the spec summary for this route is "Gets all detected rule
    // violations for Android, iOS and macOS endpoints", which says nothing
    // about when a model should reach for the tool.
    expect(declared.tools[0].description).toBe(
      'List detected compliance rule violations across Android, iOS and macOS endpoints.'
    );
  });

  it('derives parameters, types and required from the operation', () => {
    const schema = declared.tools[0].inputSchema;
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual([
      'OrderBy', 'SearchQuery', 'Page', 'PageSize', 'countOnly',
    ]);
    expect(schema.properties.Page.type).toBe('number');
    expect(schema.required).toBeUndefined();
  });

  it('marks a path parameter required without being told', () => {
    const schema = declared.tools[1].inputSchema;
    expect(schema.required).toEqual(['id']);
    expect(schema.properties.id).toEqual({
      type: 'string',
      description: 'GUID of the rule.',
    });
  });

  it('uses the canonical fragment wording, never the vendor prose', () => {
    // This is the whole point of routing derivation through schema-fragments:
    // the spec's own Page description is the 105-byte sentence the token
    // findings measured. Deriving from the spec must not reintroduce it.
    const props = declared.tools[0].inputSchema.properties;
    expect(props.Page.description).toBe(PAGE_DESCRIPTION);
    expect(props.PageSize.description).toBe(PAGE_SIZE_DESCRIPTION);
    expect(props.OrderBy.description).toBe(ORDER_BY_DESCRIPTION);
    expect(JSON.stringify(declared.tools)).not.toMatch(/zero-indexed number of the first page/);
  });

  it('spreads the local shaping vocabulary, which no spec knows about', () => {
    expect(declared.tools[0].inputSchema.properties.countOnly).toEqual({
      type: 'boolean',
      description: 'Return the match count, not the rows (default false).',
    });
  });

  it('exposes the route, so layer 3 can be checked against layer 1', () => {
    expect(declared.routeFor('get_mobile_device_rule')).toEqual({
      method: 'get',
      path: '/v2.0/Rules/{id}',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('defineTools derives the validation rules from the same declaration', () => {
  const declared = defineTools(
    compliance,
    {
      get_vulnerability: {
        op: 'GetVulnerability',
        description: 'Get one vulnerability by id.',
      },
      list_vulnerabilities: {
        op: 'GetAllVulnerabilities',
        description: 'List known vulnerabilities.',
        shaping: ['countOnly'],
      },
    }
  );

  it('is one source: every advertised property has a rule and vice versa', () => {
    // The defect this closes is stated in the header of every
    // mcp-tool-validation-rules.ts in the suite — 2,079 lines across 13
    // servers, whose own comment records that "the pre-existing rules had
    // drifted away from the schemas". Derived from one declaration, they
    // cannot.
    for (const tool of declared.tools) {
      const ruleNames = declared.rulesFor(tool.name).map((r) => r.name).sort();
      expect(ruleNames).toEqual(Object.keys(tool.inputSchema.properties).sort());
    }
  });

  it('rejects a non-GUID id with -32602 rather than passing it to bConnect', () => {
    expect(() => declared.validate('get_vulnerability', { id: 'not-a-guid' })).toThrow(
      /must be a valid GUID/
    );
    expect(() =>
      declared.validate('get_vulnerability', {
        id: '11111111-2222-3333-4444-555555555555',
      })
    ).not.toThrow();
  });

  it('rejects a missing required id', () => {
    expect(() => declared.validate('get_vulnerability', {})).toThrow(/id is required/);
  });

  it('applies the suite conventions the spec does not state: Page >= 0, PageSize 1-1000', () => {
    // Neither bound is in the spec: `Page` is a bare int32 and `PageSize` says
    // its cap only in 200 bytes of prose. Both come from `CommonRules`, which
    // is what makes the derived rules the suite's rules and not the vendor's.
    expect(() => declared.validate('list_vulnerabilities', { Page: -1 })).toThrow(
      /Page must be at least 0/
    );
    expect(() => declared.validate('list_vulnerabilities', { PageSize: 5000 })).toThrow(
      /PageSize must be at most 1000/
    );
    expect(() => declared.validate('list_vulnerabilities', { Page: 0, PageSize: 20 })).not.toThrow();
  });

  it('types the shaping vocabulary, so countOnly: "true" is refused', () => {
    // TOK-25: a string here used to sail through and return a full 15-18 KB
    // page to a caller who asked "how many?".
    expect(() => declared.validate('list_vulnerabilities', { countOnly: 'true' })).toThrow(
      /countOnly must be of type boolean, got string/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('D6: the layer refuses to over-advertise', () => {
  it('throws when `expose` names a parameter the route does not declare', () => {
    // The failure mode: bConnect answers 200 and silently drops the unknown
    // parameter, so a tool offering OrderBy on a route without it returns an
    // unsorted list that LOOKS sorted. No error is raised anywhere.
    expect(() =>
      defineTools(compliance, {
        get_vulnerability: {
          op: 'GetVulnerability',
          description: 'x',
          expose: ['id', 'OrderBy'],
        },
      })
    ).toThrow(/does not declare: OrderBy/);
  });

  it('advertises exactly the declared parameters when `expose` is omitted', () => {
    const declared = defineTools(
      compliance,
      { list_mobile_device_rules: { op: 'GetAllMobileDeviceRules', description: 'x' } }
  );
    const advertised = Object.keys(declared.tools[0].inputSchema.properties).sort();
    const spec = requireOperation(compliance, 'GetAllMobileDeviceRules').parameters
      .map((p) => p.name)
      .sort();
    expect(advertised).toEqual(spec);
  });

  it('throws when a required parameter is dropped, whichever way it is dropped', () => {
    for (const declaration of [
      { op: 'GetVulnerability', description: 'x', expose: [] as string[] },
      { op: 'GetVulnerability', description: 'x', omit: ['id'] },
    ]) {
      expect(() => defineTools(compliance, { t: declaration })).toThrow(
        /omits required parameter\(s\).*id/s
      );
    }
  });

  it('throws on a stale `omit` that names nothing', () => {
    expect(() =>
      defineTools(compliance, {
        t: { op: 'GetAllMobileDeviceRules', description: 'x', omit: ['Domain'] },
      })
    ).toThrow(/omits parameter\(s\).*does not declare: Domain/s);
  });

  it('refuses both `expose` and `omit` on one tool', () => {
    expect(() =>
      defineTools(compliance, {
        t: { op: 'GetAllMobileDeviceRules', description: 'x', expose: ['Page'], omit: ['OrderBy'] },
      })
    ).toThrow(/sets both `expose` and `omit`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('request bodies', () => {
  const declared = defineTools(
    jobs,
    {
      create_job_folder: {
        op: 'CreateFolder',
        description:
          'Create a new job folder in the baramundi job library hierarchy. ' +
          'WARNING: Creates a new folder in the jobs structure.',
        write: true,
      },
    }
  );

  it('derives body fields alongside path parameters', () => {
    const props = declared.tools[0].inputSchema.properties;
    expect(Object.keys(props).sort()).toEqual(['comment', 'name', 'parentId']);
    expect(props.name.type).toBe('string');
    // The vendor's own field prose is short and useful — "The name of the
    // folder" — so it is kept rather than reinvented. The 80-byte limit is
    // what stops the long ones being copied.
    expect((props.name.description ?? '').length).toBeLessThanOrEqual(DERIVED_DESCRIPTION_LIMIT);
  });

  it('throws when a required body field would be hidden', () => {
    // OPEN_BODY_REQUIRED in the suite's own allowlist: create_linux_endpoint
    // under-declares its required fields today, so every call 400s and the
    // caller cannot tell what was missing because no schema mentions it.
    const spec = {
      paths: {
        '/x': {
          post: {
            operationId: 'MakeX',
            parameters: [],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['displayName'],
                    properties: {
                      displayName: { type: 'string', description: 'Name.' },
                      comment: { type: 'string', description: 'Comment.' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const index = buildOperationIndex(spec, 'x');
    expect(() =>
      defineTools(index, { make_x: { op: 'MakeX', description: 'x', body: ['comment'] } })
    ).toThrow(/hides required body field\(s\).*displayName/s);
  });

  it('throws on a body field the operation does not have', () => {
    expect(() =>
      defineTools(jobs, {
        create_job_folder: { op: 'CreateFolder', description: 'x', body: ['name', 'colour'] },
      })
    ).toThrow(/does not have: colour/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('long vendor prose is refused, not copied', () => {
  const spec = {
    paths: {
      '/x': {
        get: {
          operationId: 'GetX',
          parameters: [
            {
              name: 'LastAction',
              in: 'query',
              description:
                "Filters on lastAction. Date values have to be specified in ISO 8601 format. " +
                "They can be filtered by adding the prefix 'lt' or 'gt' " +
                '(e.g. gt 2023-07-28T08:01:03.375Z).',
              schema: { type: 'string' },
            },
          ],
        },
      },
    },
  };
  const index = buildOperationIndex(spec, 'x');

  it('throws rather than paying 166 bytes on every session', () => {
    expect(() =>
      defineTools(index, { list_x: { op: 'GetX', description: 'x' } })
    ).toThrow(/has no wording for it.*over the 80 B limit/s);
  });

  it('accepts a `describe` entry, which is where the judgement belongs', () => {
    const declared = defineTools(
      index,
      {
        list_x: {
          op: 'GetX',
          description: 'x',
          describe: {
            LastAction: "Filter on lastAction, ISO 8601, optional 'lt '/'gt ' prefix.",
          },
        },
      }
    );
    expect(declared.tools[0].inputSchema.properties.LastAction.description).toMatch(/ISO 8601/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('composites pass through untouched', () => {
  const handAuthored = objectSchema(
    {
      ...guidProperty('jobInstanceId', 'job instance'),
      staleAfterDays: { type: 'number', description: 'Days without contact before stale.' },
    },
    ['jobInstanceId']
  );

  const declared = defineTools(compliance, {
    get_vulnerability: { op: 'GetVulnerability', description: 'Get one vulnerability by id.' },
    diagnose_job: composite({
      description: 'Diagnose why a job instance is failing across its assigned endpoints.',
      inputSchema: handAuthored,
    }),
  });

  it('advertises the very object the author wrote', () => {
    // ~3,400 lines of dedicated composite modules back these tools and they
    // answer no single route. Nothing here rewrites them.
    expect(declared.tools[1].inputSchema).toBe(handAuthored);
    expect(declared.tools[1].description).toBe(
      'Diagnose why a job instance is failing across its assigned endpoints.'
    );
  });

  it('has no route, and says so', () => {
    expect(declared.routeFor('diagnose_job')).toBeUndefined();
    expect(declared.routeFor('get_vulnerability')).toBeDefined();
  });

  it('carries hand-authored rules when given them', () => {
    const withRules = defineTools(compliance, {
      diagnose_job: composite({
        description: 'x',
        inputSchema: handAuthored,
        rules: [{ name: 'jobInstanceId', required: true, type: 'string', format: 'guid' }],
      }),
    });
    expect(() => withRules.validate('diagnose_job', {})).toThrow(/jobInstanceId is required/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('composes with defineToolCatalogue rather than replacing it', () => {
  const declared = defineTools(
    jobs,
    {
      get_job_folder: { op: 'GetFolder', description: 'Get one job folder by id.' },
      create_job_folder: { op: 'CreateFolder', description: 'Create a job folder.', write: true },
      delete_job_folder: { op: 'DeleteFolder', description: 'Delete a job folder.', write: true },
    }
  );

  it('returns exactly the { tools, write } shape the catalogue already takes', () => {
    const catalogue = defineToolCatalogue(declared);
    expect(catalogue.allTools().map((t) => t.name)).toEqual([
      'get_job_folder', 'create_job_folder', 'delete_job_folder',
    ]);
  });

  it('keeps declaration order, so turning the gate on is a no-op on the surface', () => {
    // tool-catalogue.ts guarantee 1: with ALLOW_WRITE_OPERATIONS=true the
    // advertised list is exactly what was declared, in order.
    const catalogue = defineToolCatalogue(declared);
    expect(catalogue.listTools({ ALLOW_WRITE_OPERATIONS: 'true' } as NodeJS.ProcessEnv)).toEqual(
      catalogue.allTools()
    );
  });

  it('hides the writes when the gate is shut', () => {
    const catalogue = defineToolCatalogue(declared);
    expect(catalogue.listTools({} as NodeJS.ProcessEnv).map((t) => t.name)).toEqual([
      'get_job_folder',
    ]);
    expect(catalogue.gateWriteTool('create_job_folder', {} as NodeJS.ProcessEnv)).toMatchObject({
      isError: true,
    });
  });

  it('feeds declaredParameters(), so an unknown argument key is still rejected', () => {
    // SEC-0/D6 again, from the other end: the catalogue's unknown-key check
    // reads the schema this layer derived, so the two cannot disagree.
    const catalogue = defineToolCatalogue(declared);
    expect([...catalogue.declaredParameters().get('get_job_folder')!]).toEqual(['id']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('what a real server declaration costs', () => {
  it('derives all 8 compliance wrapper tools from 8 op+description pairs', () => {
    // The measurable claim behind the layer: for a 1:1 wrapper, everything
    // except the description is mechanical. 87% of endpoints tools and 84% of
    // jobs tools are 1:1 wrappers.
    const index: OperationIndex = compliance;
    const declarations = Object.fromEntries(
      Object.keys(index.operations).map((op) => [
        `tool_${op.toLowerCase()}`,
        { op, description: `Description for ${op}.` },
      ])
    );
    const declared = defineTools(index, declarations);

    expect(declared.tools).toHaveLength(8);
    for (const tool of declared.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(declared.rulesFor(tool.name).length).toBeGreaterThan(0);
      // No vendor boilerplate reached the catalogue.
      for (const property of Object.values(tool.inputSchema.properties)) {
        expect((property.description ?? '').length).toBeLessThanOrEqual(DERIVED_DESCRIPTION_LIMIT);
      }
    }
  });
});
