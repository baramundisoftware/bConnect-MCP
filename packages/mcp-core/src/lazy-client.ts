/**
 * A client built on first use (REQ-XC-001).
 *
 * The servers create their bConnect client at the top of the tool handler.
 * Built eagerly, a configuration error (missing credentials) would win over a
 * call that fails before it needs the client: an unknown tool, invalid
 * arguments, a tool the selected release doesn't have. Those must stay
 * protocol errors, so the client is only built when a tool first uses it.
 */
export function lazyClient<T extends object>(create: () => T): T {
  let instance: T | undefined;
  const target: object = Object.create(null);
  return new Proxy(target, {
    get: (_target, property) => Reflect.get(instance ??= create(), property),
  }) as T;
}
