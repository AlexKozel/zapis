/** Минимальный expect поверх node:assert, чтобы тесты не требовали внешних пакетов. */
import assert from "node:assert/strict";

function isSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (actual === null || typeof actual !== "object") return false;
  return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
    isSubset((actual as Record<string, unknown>)[k], v),
  );
}

export function expect(actual: unknown) {
  return {
    toBe: (expected: unknown) => assert.equal(actual, expected),
    toEqual: (expected: unknown) => assert.deepEqual(actual, expected),
    toMatchObject: (expected: object) =>
      assert.ok(isSubset(actual, expected), `${JSON.stringify(actual)} не содержит ${JSON.stringify(expected)}`),
    toContain: (part: string) => assert.ok(String(actual).includes(part), `«${String(actual)}» не содержит «${part}»`),
    toHaveLength: (n: number) => assert.equal((actual as unknown[]).length, n),
  };
}
