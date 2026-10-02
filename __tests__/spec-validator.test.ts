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
      NullableTypedRef: { type: 'object', $ref: '#/components/schemas/Base', nullable: true },
      Level1: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
      Level2: { allOf: [ref('Level1'), { type: 'object', properties: { b: { type: 'string' } }, additionalProperties: false }] },
      Level3: { allOf: [ref('Level2'), { type: 'object', properties: { c: { type: 'string' } }, additionalProperties: false }] },
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
    // type next to $ref: still the anyOf form, because the $ref would reject null.
    ok('NullableTypedRef', null);
    bad('NullableTypedRef', {});
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

  it('OpenAPI numeric formats check type and range', () => {
    ok('Count', 7);
    ok('Big', 9007199254740991);
    ok('Ratio', 1.5);
    ok('Share', 0.25);
    bad('Count', 'x');
    bad('Count', 1.5);
    bad('Count', 2 ** 31);
    bad('Ratio', 'x');
  });

  it('a format the validator does not know fails the compile instead of being skipped', () => {
    const odd = { components: { schemas: { Odd: { type: 'string', format: 'not-a-known-format' } } } };
    expect(() => checkSchema(odd, 'Odd', 'x')).toThrow(/unknown format/);
  });

  it('allOf with a closed member accepts the union of the members and rejects anything else', () => {
    ok('Closed', { name: 'x' });
    ok('Closed', { name: 'x', extra: 1 });
    bad('Closed', { name: 'x', other: 1 });
    bad('Closed', { extra: 1 });
    bad('Closed', { name: 'x', extra: 'no' });
  });

  it('format time accepts the .NET text a bMS sends (hh:mm, optional seconds and offset), and rejects invalid times', () => {
    for (const t of ['02:58', '23:55', '02:00:00', '23:59:59.1234567', '00:00:00.5', '02:00:00Z', '02:00:00+02:00']) ok('Time', t);
    for (const t of ['25:00:00', '24:00', '02:60', '2:58', '02:5', 'abc', '1.02:00:00', '02:00:00.12345678', '23:59:60Z']) bad('Time', t);
  });

  it('allOf over several levels: each level allows the union of all levels below it', () => {
    ok('Level3', { a: 'x', b: 'y', c: 'z' });
    ok('Level2', { a: 'x', b: 'y' });
    bad('Level3', { a: 'x', b: 'y', c: 'z', d: 1 });
    bad('Level2', { a: 'x', c: 'z' });
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

  it('reports one bad value inside a discriminated, nullable oneOf once, at its own path (real 26R1 Jobs spec)', () => {
    const jobs = loadOperations('26R1').find((o) => o.domain === 'jobs')!.spec;
    const validity = (periods: unknown) => ({ start: null, end: null, validityPeriods: periods });
    expect(checkSchema(jobs, 'JobValidity', validity({ type: 'Everyday', validityPeriods: [{ start: '08:00', end: '17:30' }] }))).toEqual([]);
    expect(checkSchema(jobs, 'JobValidity', validity(null))).toEqual([]);
    expect(checkSchema(jobs, 'JobValidity', validity({ type: 'Everyday', validityPeriods: [{ start: '08:00', end: '25:00' }] }))).toEqual([
      { path: '/validityPeriods/validityPeriods/[]/end', keyword: 'format', message: 'must match format "time"' },
    ]);
    expect(checkSchema(jobs, 'JobValidity', validity({ type: 'Hourly' })).map((f) => `${f.path} ${f.keyword}`)).toEqual([
      '/validityPeriods/type enum',
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

    it('accepts the intervals the bMS returned', () => {
      expect(check([{ type: 'Daily', time: '02:58' }, { type: 'Weekly', weekdays: ['Friday'], time: '23:55' }])).toEqual([]);
      expect(check([{ type: 'Weekly', time: '02:00:00', weekdays: ['Monday', 'Friday'] }])).toEqual([]);
    });

    it('rejects an unknown property, a wrong type value and an invalid time', () => {
      expect(check([{ type: 'Daily', time: '02:00:00', foo: 1 }]).length).toBeGreaterThan(0);
      expect(check([{ type: 'Daily', time: '02:00:00', weekdays: ['Monday'] }]).length).toBeGreaterThan(0);
      expect(check([{ type: 'Hourly', time: '02:00:00' }]).length).toBeGreaterThan(0);
      expect(check([{ type: 'Daily', time: '25:00' }]).length).toBeGreaterThan(0);
    });
  });
});
