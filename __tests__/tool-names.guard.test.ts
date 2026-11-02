/**
 * Tool names are unique across all servers (#338).
 *
 * A client that combines several servers (Claude Desktop, VS Code, the
 * gateway's clients) sees one tool list; two servers offering the same name
 * would collide. This guard lists every tool of every server in both bMS
 * releases, with all gates open so every tool is listed, and fails on a name
 * that occurs twice.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { RELEASES } from './lib/spec.js';
import { SERVERS, connect, guardEnv } from './lib/exerciser.js';

/** Each name that more than one server (or one server twice) lists, with the servers. */
function duplicates(byServer: Record<string, string[]>): string[] {
  const owners = new Map<string, string[]>();
  for (const [server, names] of Object.entries(byServer)) {
    for (const name of names) {owners.set(name, [...(owners.get(name) ?? []), server]);}
  }
  return [...owners].filter(([, servers]) => servers.length > 1).map(([name, servers]) => `${name}: ${servers.join(', ')}`).sort();
}

const savedEnv = { ...process.env };
afterAll(() => { process.env = savedEnv; });

describe('tool names', () => {
  it('the check finds a name two servers list, and one listed twice (self-test)', () => {
    expect(duplicates({ a: ['list_x', 'get_x'], b: ['list_x', 'get_y'], c: ['get_z', 'get_z'] }))
      .toEqual(['get_z: c, c', 'list_x: a, b']);
    expect(duplicates({ a: ['list_x'], b: ['get_y'] })).toEqual([]);
  });

  it.each(RELEASES)('are unique across all servers in %s', async (release) => {
    Object.assign(process.env, guardEnv(release, { writes: true, secretRead: true }));
    const byServer: Record<string, string[]> = {};
    for (const server of SERVERS) {
      const conn = await connect(server);
      byServer[server] = conn.tools.map((tool) => tool.name);
      await conn.close();
    }
    expect(Object.values(byServer).flat().length).toBeGreaterThan(100);
    expect(duplicates(byServer)).toEqual([]);
  });
});
