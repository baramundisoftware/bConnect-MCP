/**
 * Non-success answers a live bMS gives for a reason that is not a defect, listed
 * per tool with the status, the problem detail the bMS sends, and the reason.
 * Everything else that fails, fails the run. Each entry is reported.
 */

interface Expected { status: number; detail?: RegExp; reason: string }

const EXPECTED: Readonly<Record<string, Expected>> = {
  get_maintenance_window_for_endpoint: {
    status: 409, detail: /no maintenance window/i,
    reason: 'the endpoint has no maintenance window; the bMS answers 409 "Requested resource has no maintenance window"',
  },
  get_maintenance_window_for_logical_group: {
    status: 409, detail: /no maintenance window/i,
    reason: 'the logical group has no maintenance window; the bMS answers 409 "Requested resource has no maintenance window"',
  },
  list_unmanaged_endpoints: {
    status: 503,
    reason: 'the bMS service behind unmanaged endpoints is not running on the test bMS; it answers 503',
  },
};

function detailOf(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('detail' in body)) return '';
  return typeof body.detail === 'string' ? body.detail : '';
}

/** The reason a tool's failed call is expected, or undefined when it is a failure. */
export function expectedAnswer(tool: string, answers: Array<{ status: number; body: unknown }>): string | undefined {
  const entry = Object.hasOwn(EXPECTED, tool) ? EXPECTED[tool] : undefined;
  if (!entry || answers.length === 0) return undefined;
  const fits = answers.every((a) => a.status === entry.status && (!entry.detail || entry.detail.test(detailOf(a.body))));
  return fits ? entry.reason : undefined;
}
