/**
 * The one js-yaml function the guards use (#337). js-yaml ships no types, and
 * this saves a @types package for a test-only dependency.
 */
declare module 'js-yaml' {
  export function load(text: string): unknown;
}
