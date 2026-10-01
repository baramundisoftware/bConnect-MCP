/**
 * Results of a live run: the checks on the run as a whole.
 */
import { LiveConfigError } from './env.js';

/** A live run that exercised nothing is a failed run, not a pass. */
export function assertExercised(counts: { startups: number; calls: number }): void {
  if (counts.startups === 0 && counts.calls === 0) throw new LiveConfigError('nothing was exercised: no server started and no tool was called');
  if (counts.calls === 0) throw new LiveConfigError('no read tool was called against the bMS');
}
