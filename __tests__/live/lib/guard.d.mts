import type { SetupServerApi } from 'msw/node';

export interface Refused { method: string; path: string; reason: string }

export function refusal(method: string, url: string, origin: string): string | undefined;

export function createGuard(options: {
  origin: string;
  onResponse?: (request: Request, response: Response) => void;
}): { server: SetupServerApi; refused: Refused[] };
