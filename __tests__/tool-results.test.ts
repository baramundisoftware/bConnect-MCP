/**
 * Tool results are compact JSON, formatted in one place (REQ-SRV-025, #164).
 *
 * `toolJson` is the only place that chooses the format: compact by default,
 * indented as before with BCONNECT_PRETTY_JSON=true. `toolJsonResult` wraps it
 * into the MCP text content, with an optional lead line before the JSON.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientConfigError, prettyJsonSetting } from '../packages/mcp-core/src/client-config.js';
import { toolJson, toolJsonResult } from '../packages/mcp-core/src/tool-results.js';

const VALUE = { data: [{ id: 'a', tags: ['x', 'y'], nested: { on: true, n: 1.5, none: null } }], totalItems: 1 };

afterEach(() => { vi.unstubAllEnvs(); });

describe('prettyJsonSetting', () => {
  it.each([undefined, '', '   ', 'false', 'FALSE', ' False '])('%j means compact', (value) => {
    expect(prettyJsonSetting(value)).toBe(false);
  });

  it.each(['true', 'TRUE', ' True ', '\ttrue\n'])('%j means indented', (value) => {
    expect(prettyJsonSetting(value)).toBe(true);
  });

  it.each(['yes', '1', 'on', 'pretty', 'true false'])('refuses %j, naming the variable and the allowed values', (value) => {
    const run = () => prettyJsonSetting(value);
    expect(run).toThrow(ClientConfigError);
    expect(run).toThrow(`BCONNECT_PRETTY_JSON "${value}" isn't valid. Use true or false, or leave it unset for compact JSON.`);
  });

  it('shows an invalid value escaped and shortened, so it cannot forge log lines', () => {
    expect(() => prettyJsonSetting('true\n[AUDIT] forged \u001b[2J')).toThrow(String.raw`BCONNECT_PRETTY_JSON "true\n[AUDIT] forged \u001b[2J" isn't valid.`);
    expect(() => prettyJsonSetting('x'.repeat(5000))).toThrow(`BCONNECT_PRETTY_JSON "${'x'.repeat(64)}…" isn't valid.`);
  });
});

describe('toolJson', () => {
  it('writes compact JSON by default', () => {
    vi.stubEnv('BCONNECT_PRETTY_JSON', undefined);
    expect(toolJson(VALUE)).toBe(JSON.stringify(VALUE));
  });

  it('writes the two-space format with BCONNECT_PRETTY_JSON=true', () => {
    vi.stubEnv('BCONNECT_PRETTY_JSON', 'true');
    expect(toolJson(VALUE)).toBe(JSON.stringify(VALUE, null, 2));
  });

  it('reads the setting on every call', () => {
    vi.stubEnv('BCONNECT_PRETTY_JSON', 'true');
    expect(toolJson(VALUE)).toContain('\n');
    vi.stubEnv('BCONNECT_PRETTY_JSON', 'false');
    expect(toolJson(VALUE)).not.toContain('\n');
  });

  it('takes the environment as a parameter', () => {
    expect(toolJson(VALUE, { BCONNECT_PRETTY_JSON: 'true' })).toBe(JSON.stringify(VALUE, null, 2));
    expect(toolJson(VALUE, {})).toBe(JSON.stringify(VALUE));
  });

  it('keeps the data: both forms parse to the same value', () => {
    expect(JSON.parse(toolJson(VALUE, {}))).toEqual(JSON.parse(toolJson(VALUE, { BCONNECT_PRETTY_JSON: 'true' })));
  });

  it('writes a string as a JSON string, in both forms', () => {
    expect(toolJson('2026-10-02T22:00:00Z', {})).toBe('"2026-10-02T22:00:00Z"');
    expect(toolJson('2026-10-02T22:00:00Z', { BCONNECT_PRETTY_JSON: 'true' })).toBe('"2026-10-02T22:00:00Z"');
  });

  it('writes null for undefined, so a result always has text', () => {
    expect(toolJson(undefined, {})).toBe('null');
    expect(toolJson(undefined, { BCONNECT_PRETTY_JSON: 'true' })).toBe('null');
  });

  it('refuses an invalid setting', () => {
    expect(() => toolJson(VALUE, { BCONNECT_PRETTY_JSON: 'yes' })).toThrow(ClientConfigError);
  });
});

describe('toolJsonResult', () => {
  it('is one text content with the JSON', () => {
    vi.stubEnv('BCONNECT_PRETTY_JSON', undefined);
    expect(toolJsonResult(VALUE)).toEqual({ content: [{ type: 'text', text: JSON.stringify(VALUE) }] });
  });

  it('puts a lead line before the JSON', () => {
    vi.stubEnv('BCONNECT_PRETTY_JSON', undefined);
    expect(toolJsonResult(VALUE, { lead: 'Network endpoint 1 updated:' }).content[0].text)
      .toBe(`Network endpoint 1 updated:\n${JSON.stringify(VALUE)}`);
  });

  it('keeps the lead line as it is in the indented form', () => {
    vi.stubEnv('BCONNECT_PRETTY_JSON', 'true');
    expect(toolJsonResult(VALUE, { lead: 'MSW cleanup executed:' }).content[0].text)
      .toBe(`MSW cleanup executed:\n${JSON.stringify(VALUE, null, 2)}`);
  });

  it('is not an error result', () => {
    expect(toolJsonResult(VALUE)).not.toHaveProperty('isError');
  });
});
