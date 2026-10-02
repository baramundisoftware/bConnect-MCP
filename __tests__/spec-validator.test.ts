/**
 * The shared spec validator (REQ-QA-005): one OpenAPI 3.0 → JSON Schema
 * conversion and one ajv setup for request bodies (spec-conformance guard) and
 * 2xx answers (live tier).
 *
 * Each normalisation has a fixture that is valid only with it, and a known-bad
 * fixture that must stay invalid with it; removing any normalisation turns at
 * least one test red.
 */
import { describe, expect, it } from 'vitest';
import { RELEASES, type ApiOperation, type Schema, loadOperations } from './lib/spec.js';
import { checkSchema, specValidator, toJsonSchema } from './lib/spec-validator.js';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/** A small OpenAPI 3.0 document with one schema per spec pattern the validator handles. */
const doc: Schema = {
  openapi: '3.0.1',
  paths: {},
  components: {
    schemas: {
      NullableString: { type: 'string', nullable: true },
      Base: { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false },
      NullableRef: { allOf: [ref('Base')], nullable: true },
      NullableEnum: { type: 'string', enum: ['A', 'B'], nullable: true },
      Id: { type: 'string', format: 'guid' },
      Count: { type: 'integer', format: 'int32' },
      Big: { type: 'integer', format: 'int64' },
      Ratio: { type: 'number', format: 'double' },
      Share: { type: 'number', format: 'float' },
      Closed: { allOf: [ref('Base'), { type: 'object', properties: { extra: { type: 'integer' } }, additionalProperties: false }] },
      Time: { type: 'string', format: 'time' },
      Shape: {
        type: 'object', required: ['kind'], properties: { kind: { type: 'string' } }, additionalProperties: false,
        discriminator: { propertyName: 'kind', mapping: { Circle: '#/components/schemas/Circle', Square: '#/components/schemas/Square' } },
      },
      Circle: { allOf: [ref('Shape'), { type: 'object', properties: { radius: { type: 'number' } }, additionalProperties: false }] },
      Square: { allOf: [ref('Shape'), { type: 'object', properties: { side: { type: 'number' } }, additionalProperties: false }] },
      AnyShape: { oneOf: [ref('Circle'), ref('Square')] },
      Bases: { type: 'array', items: ref('Base') },
    },
  },
};

const ok = (name: string, data: unknown) => expect(checkSchema(doc, name, data), `${name} ${JSON.stringify(data)}`).toEqual([]);
const bad = (name: string, data: unknown) => expect(checkSchema(doc, name, data).length, `${name} ${JSON.stringify(data)} must be invalid`).toBeGreaterThan(0);

describe('spec validator normalisations (fixtures)', () => {
  it('OpenAPI nullable on a type accepts null and still checks the type', () => {
    ok('NullableString', null);
    ok('NullableString', 'x');
    bad('NullableString', 5);
  });

  it('OpenAPI nullable on a $ref/allOf accepts null and still checks the referenced schema', () => {
    ok('NullableRef', null);
    ok('NullableRef', { name: 'x' });
    bad('NullableRef', {});
  });

  it('OpenAPI nullable on a type with an inline enum accepts null and still checks the enum', () => {
    ok('NullableEnum', null);
    ok('NullableEnum', 'A');
    bad('NullableEnum', 'C');
  });

  it('guid is a real format', () => {
    ok('Id', '0f8fad5b-d9cb-469f-a165-70867728950e');
    ok('Id', '0F8FAD5B-D9CB-469F-A165-70867728950E');
    bad('Id', 'not-a-guid');
    bad('Id', '0f8fad5b-d9cb-469f-a165-70867728950');
  });

  it('OpenAPI numeric formats are annotations; the type is still checked', () => {
    ok('Count', 7);
    ok('Big', 9007199254740991);
    ok('Ratio', 1.5);
    ok('Share', 0.25);
    bad('Count', 'x');
    bad('Count', 1.5);
    bad('Ratio', 'x');
  });

  it('allOf with a closed member accepts the union of the members and rejects anything else', () => {
    ok('Closed', { name: 'x' });
    ok('Closed', { name: 'x', extra: 1 });
    bad('Closed', { name: 'x', other: 1 });
    bad('Closed', { extra: 1 });
    bad('Closed', { name: 'x', extra: 'no' });
  });

  it('format time accepts TimeSpan text without an offset, and rejects invalid times', () => {
    for (const t of ['02:00:00', '23:59:59.1234567', '00:00:00.5', '02:00:00Z', '02:00:00+02:00']) ok('Time', t);
    for (const t of ['25:00:00', '02:60:00', 'abc', '02:00', '1.02:00:00', '02:00:00.12345678']) bad('Time', t);
  });

  it('a discriminator mapping makes a oneOf of subtypes match exactly one', () => {
    ok('AnyShape', { kind: 'Circle' });
    ok('AnyShape', { kind: 'Circle', radius: 2 });
    ok('AnyShape', { kind: 'Square', side: 1 });
    bad('AnyShape', { kind: 'Circle', side: 1 });
    bad('AnyShape', { kind: 'Triangle' });
    bad('AnyShape', { radius: 2 });
  });

  it('leaves the input document unchanged', () => {
    const before = JSON.stringify(doc);
    toJsonSchema(doc);
    checkSchema(doc, 'AnyShape', { kind: 'Circle' });
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('spec validator findings', () => {
  it('folds array indices, removes duplicates and names an unknown property once', () => {
    expect(checkSchema(doc, 'Bases', [{ name: 'a', foo: 1 }, { name: 'b', foo: 2 }])).toEqual([
      { path: '/[]', keyword: 'additionalProperties', message: "must NOT have additional properties 'foo'" },
    ]);
  });

  it('names a missing required property once', () => {
    expect(checkSchema(doc, 'Base', {})).toEqual([
      { path: '/', keyword: 'required', message: "must have required property 'name'" },
    ]);
  });

  it('throws for a schema name the document does not have', () => {
    expect(() => checkSchema(doc, 'Missing', {})).toThrow(/Missing/);
  });
});

/** Operations with a 2xx application/json response schema, derived here from the spec, not from ApiOperation. */
function jsonAnswerOps(ops: ApiOperation[]): ApiOperation[] {
  return ops.filter((op) => Object.entries<Schema>(op.spec.paths[op.path][op.method.toLowerCase()].responses)
    .some(([code, r]) => /^2/.test(code) && r.content?.['application/json']?.schema));
}

describe('spec validator on the bundled specs', () => {
  for (const release of RELEASES) {
    it(`${release}: every 2xx JSON answer schema and every JSON request schema compiles`, () => {
      const v = specValidator(release);
      const ops = loadOperations(release);
      const answers = jsonAnswerOps(ops);
      expect(answers.length).toBeGreaterThan(150);
      for (const op of answers) {
        expect(op.okStatus, `${op.operationId} okStatus`).toMatch(/^2\d\d$/);
        expect(() => v.response(op, {}), `${op.operationId} response`).not.toThrow();
      }
      let bodies = 0;
      for (const op of ops) {
        for (const type of Object.keys(op.requestBodies).filter((t) => t !== 'application/json-patch+json')) {
          bodies++;
          expect(() => v.body(op, type, {}), `${op.operationId} ${type} body`).not.toThrow();
        }
      }
      expect(bodies).toBeGreaterThan(20);
    });
  }

  it('throws, naming the operation, for an operation without a 2xx JSON answer', () => {
    const del = loadOperations('26R1').find((o) => o.domain === 'assets' && o.operationId === 'DeleteAsset')!;
    expect(del.okStatus).toBeUndefined();
    expect(() => specValidator('26R1').response(del, {})).toThrow(/DeleteAsset/);
  });

  it('checks request bodies against the real spec, with nullable and guid', () => {
    const v = specValidator('26R1');
    const createFolder = loadOperations('26R1').find((o) => o.domain === 'assets' && o.operationId === 'CreateAssetStockFolder')!;
    expect(v.body(createFolder, 'application/json', { name: 'Folder', parentId: null })).toEqual([]);
    expect(v.body(createFolder, 'application/json', { name: 42 }).length).toBeGreaterThan(0);
    expect(v.body(createFolder, 'application/json', { name: 'F', parentId: 'not-a-guid' }).length).toBeGreaterThan(0);
    expect(v.body(createFolder, 'application/json', { name: 'F', parentId: 'not-a-guid' }, { ignoreFormats: true })).toEqual([]);
  });

  describe('26R1 DownloadJob answers in the shape a bMS returns (#194)', () => {
    const getJob = loadOperations('26R1').find((o) => o.domain === 'servermanagement' && o.operationId === 'GetDownloadJob')!;
    const job = (interval: unknown[]) => ({ id: '0f8fad5b-d9cb-469f-a165-70867728950e', name: 'Nightly', interval });
    const check = (interval: unknown[]) => specValidator('26R1').response(getJob, job(interval));

    it('accepts daily and weekly intervals with TimeSpan times', () => {
      expect(check([{ type: 'Daily', time: '02:00:00' }])).toEqual([]);
      expect(check([{ type: 'Weekly', time: '02:00:00', weekdays: ['Monday', 'Friday'] }])).toEqual([]);
      expect(check([{ type: 'Daily', time: '02:00:00' }, { type: 'Weekly', time: '22:30:00', weekdays: ['Sunday'] }])).toEqual([]);
    });

    it('rejects an unknown property, a wrong type value and an invalid time', () => {
      expect(check([{ type: 'Daily', time: '02:00:00', foo: 1 }]).length).toBeGreaterThan(0);
      expect(check([{ type: 'Daily', time: '02:00:00', weekdays: ['Monday'] }]).length).toBeGreaterThan(0);
      expect(check([{ type: 'Hourly', time: '02:00:00' }]).length).toBeGreaterThan(0);
      expect(check([{ type: 'Daily', time: '25:00:00' }]).length).toBeGreaterThan(0);
    });
  });
});
