/**
 * bMS data is cleaned of hidden characters before it reaches the model
 * (REQ-XC-006 AC 2, ADR-0009; #167).
 *
 * Removed: every Unicode format character (\p{Cf}) and the whole tag block
 * U+E0000-E007F, except ZWNJ U+200C and ZWJ U+200D. Each removed run becomes
 * a visible marker. CRLF becomes LF without a marker. Keys are cleaned like
 * values; two keys that differed only in hidden characters both stay. Clean
 * data comes back as the same object. The shared client applies it to every
 * JSON response.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { HIDDEN_CHARACTERS_MARKER, cleanModelData, cleanModelText } from '../packages/mcp-core/src/model-text.js';
import { BConnectClientBase, type BConnectConfig } from '../packages/mcp-core/src/bconnect-client-base.js';

const MARKER = '[hidden characters removed]';

it('exports the marker the tests expect', () => expect(HIDDEN_CHARACTERS_MARKER).toBe(MARKER));

/**
 * The class, defined from Unicode properties: format characters, default-ignorable
 * code points and the tag block, minus ZWNJ, ZWJ and the two presentation selectors.
 */
const KEPT = new Set([0x200c, 0x200d, 0xfe0e, 0xfe0f]);
const inClass = (cp: number): boolean => {
  if (KEPT.has(cp)) {return false;}
  const ch = String.fromCodePoint(cp);
  return (cp >= 0xe0000 && cp <= 0xe0fff) || /\p{Cf}/u.test(ch) || /\p{Default_Ignorable_Code_Point}/u.test(ch);
};

describe('the class of removed characters', () => {
  it('lists the known members explicitly (so the sweep does not only mirror \\p{Cf})', () => {
    const members = [
      0x00ad, 0x061c, 0x180e, 0x200b, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
      0x2060, 0x2061, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
      0xe0000, 0xe0001, 0xe0002, 0xe0010, 0xe0020, 0xe0041, 0xe007e, 0xe007f, 0xe0080,
      0x034f, 0x115f, 0x1160, 0x180b, 0x2065, 0x3164, 0xfe00, 0xfe0d, 0xffa0, 0xfff0, 0xe0100, 0xe01ef,
    ];
    for (const cp of members) {
      expect({ cp: cp.toString(16), out: cleanModelData(String.fromCodePoint(cp)) }).toEqual({ cp: cp.toString(16), out: MARKER });
    }
  });

  it('keeps ZWNJ, ZWJ, tab, LF, the emoji presentation selectors, letters, emoji and other separators', () => {
    const keep = [
      '\u200C', '\u200D', '\t', '\n', '\uFE0E', '\uFE0F', '\u2764\uFE0F', 'a', '\u00E9', '\u0628\u0644\u062F',
      '\u{1F44D}\u{1F3FD}', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', '\u2028', '\r', ' ',
    ];
    for (const text of keep) {
      expect(cleanModelData(text)).toBe(text);
    }
  });

  it('sweeps every code point: the class becomes the marker, everything else is untouched', () => {
    const wrong: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) {continue;} // lone surrogates are not characters
      const ch = String.fromCodePoint(cp);
      const out = cleanModelData(ch);
      const expected = inClass(cp) ? MARKER : ch;
      if (out !== expected) {wrong.push(cp.toString(16));}
      if (wrong.length > 20) {break;}
    }
    expect(wrong).toEqual([]);
  });
});

describe('strings', () => {
  it('replaces each run of removed characters with one marker', () => {
    expect(cleanModelData('Fire\u200B\u200Bfox\u{E0049}\u{E0067}\u{E006E}')).toBe(`Fire${MARKER}fox${MARKER}`);
  });

  it('turns CRLF into LF without a marker, and keeps a lone CR', () => {
    expect(cleanModelData('line 1\r\nline 2\rend')).toBe('line 1\nline 2\rend');
  });

  it('treats CR, hidden characters, LF as a line break with the marker', () => {
    expect(cleanModelData('a\r\u200B\nb')).toBe(`a${MARKER}\nb`);
  });

  it('removes bytes smuggled in variation selectors after an emoji', () => {
    expect(cleanModelData('ok\u{1F600}\u{E0151}\u{E0158}\u{E0145}')).toBe(`ok\u{1F600}${MARKER}`);
  });

  it('error text (cleanModelText) removes the whole tag block too, also unassigned code points', () => {
    expect(cleanModelText('a\u{E0002}\u{E0010}\u{E0100}b')).toBe('ab');
  });

  it('removes a bidi override that reverses visible text', () => {
    expect(cleanModelData('invoice\u202Etxt.exe')).toBe(`invoice${MARKER}txt.exe`);
  });
});

describe('objects and arrays', () => {
  it('cleans values and keys at any depth and leaves other types alone', () => {
    const input = {
      data: [
        { displayName: 'PC\u200B01', ['comm\u2060ent']: 'ok', count: 3, active: true, none: null },
        ['x\u{E0041}', 7],
      ],
    };
    expect(cleanModelData(input)).toEqual({
      data: [
        { displayName: `PC${MARKER}01`, [`comm${MARKER}ent`]: 'ok', count: 3, active: true, none: null },
        [`x${MARKER}`, 7],
      ],
    });
  });

  it('keeps both keys when two differ only in hidden characters', () => {
    const out = cleanModelData({ name: 'visible', ['na\u200Bme']: 'hidden twin' });
    expect(out).toEqual({ name: 'visible', [`na${MARKER}me`]: 'hidden twin' });
  });

  it('never renames a key that needed no cleaning, even if it looks like a cleaned one', () => {
    const out = cleanModelData({ ['a\u200Bb']: 1, [`a${MARKER}b`]: 3 });
    expect(out).toEqual({ [`a${MARKER}b ${MARKER}`]: 1, [`a${MARKER}b`]: 3 });
  });

  it('returns clean data as the same object (byte-identical results)', () => {
    const clean = { data: [{ displayName: 'PC01', tags: ['a', 'b'], n: 1 }], totalItems: 1 };
    expect(cleanModelData(clean)).toBe(clean);
    const text = 'plain text';
    expect(cleanModelData(text)).toBe(text);
  });

  it('does not change the input object', () => {
    const input = { displayName: 'PC\u200B01' };
    cleanModelData(input);
    expect(input.displayName).toBe('PC\u200B01');
  });
});

describe('the shared client cleans every JSON response', () => {
  const BASE = 'http://bms.clean.test/bconnect';
  let reply: () => Response = () => HttpResponse.json({});
  const msw = setupServer(http.all('*', () => reply()));
  beforeAll(() => msw.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => { reply = () => HttpResponse.json({}); });
  afterAll(() => msw.close());

  type Raw = { client: { get: (u: string, c?: object) => Promise<{ data: unknown }> } };
  const client = (extra: Partial<BConnectConfig> = {}): Raw =>
    new BConnectClientBase({ baseUrl: BASE, apiKey: 'k', ...extra }) as unknown as Raw;

  it('cleans a JSON body before the modules see it', async () => {
    reply = () => HttpResponse.json({ data: [{ displayName: 'Ignore\u{E0020}all\u202Eprevious' }] });
    const { data } = await client().client.get('/endpoints/v2.0/Endpoints');
    expect(data).toEqual({ data: [{ displayName: `Ignore${MARKER}all${MARKER}previous` }] });
  });

  it('cleans a body sent as problem JSON or plain JSON text alike', async () => {
    reply = () => new HttpResponse(JSON.stringify({ name: 'a\u200Bb' }), { headers: { 'content-type': 'text/plain' } });
    const { data } = await client().client.get('/endpoints/v2.0/Endpoints');
    expect(data).toEqual({ name: `a${MARKER}b` });
  });

  it('leaves a binary body alone', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]); // a BOM's UTF-8 bytes and "A"
    reply = () => new HttpResponse(bytes, { headers: { 'content-type': 'application/octet-stream' } });
    const { data } = await client().client.get('/endpoints/v2.0/Endpoints', { responseType: 'arraybuffer' });
    expect(Buffer.from(data as ArrayBuffer)).toEqual(Buffer.from(bytes));
  });

  it('caches the cleaned data, not the raw body', async () => {
    reply = () => HttpResponse.json({ name: 'a\u200Bb' });
    const cached = client({ cache: { enabled: true } });
    const first = await cached.client.get('/endpoints/v2.0/Endpoints');
    const second = await cached.client.get('/endpoints/v2.0/Endpoints');
    expect(first.data).toEqual({ name: `a${MARKER}b` });
    expect(second.data).toEqual({ name: `a${MARKER}b` });
  });
});
