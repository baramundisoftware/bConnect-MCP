import type { SetupServerApi } from 'msw/node';

export interface Refused { method: string; path: string; reason: string }

export function refusal(method: string, url: string, origin: string): string | undefined;

export function createGuard(options: {
  origin: string;
  onRequest?: (request: Request, refusedBecause: string | undefined) => void;
  onResponse?: (request: Request, response: Response) => void;
}): {
  server: SetupServerApi;
  refused: Refused[];
  /** Install the guard, including for named ESM imports of node:http/https. */
  start(): void;
  /** Remove the guard. */
  stop(): void;
};
