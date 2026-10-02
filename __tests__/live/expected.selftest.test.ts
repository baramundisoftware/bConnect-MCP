/**
 * Self-test of the per-tool list of expected non-success answers. Needs no bMS.
 */
import { describe, expect, it } from 'vitest';
import { expectedAnswer } from './lib/expected.js';

const noWindow = { status: 409, body: { title: 'Conflict', status: 409, detail: 'Requested resource has no maintenance window' } };

describe('expected non-success answers', () => {
  it('accepts a listed tool with its status and detail, and gives the reason', () => {
    expect(expectedAnswer('get_maintenance_window_for_endpoint', [noWindow])).toMatch(/no maintenance window/);
    expect(expectedAnswer('get_maintenance_window_for_logical_group', [noWindow])).toMatch(/no maintenance window/);
  });

  it('does not accept the same status from another tool', () => {
    expect(expectedAnswer('get_endpoint', [noWindow])).toBeUndefined();
  });

  it('does not accept a listed tool with another detail or status', () => {
    expect(expectedAnswer('get_maintenance_window_for_endpoint', [{ status: 409, body: { detail: 'Version conflict' } }])).toBeUndefined();
    expect(expectedAnswer('get_maintenance_window_for_endpoint', [{ status: 500, body: null }])).toBeUndefined();
  });

  it('does not accept a call that sent nothing', () => {
    expect(expectedAnswer('get_maintenance_window_for_endpoint', [])).toBeUndefined();
  });
});
