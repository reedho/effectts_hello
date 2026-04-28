/**
 * Smoke test demonstrating the `bun:test` half of the dual-runner setup.
 *
 * Files matching `*.bun.test.ts` are run by `bun:test` (`bun run test:bun`)
 * and excluded from vitest. Use this runner for tests that don't involve
 * Effect — pure utilities, data shapes, Bun-specific APIs, etc.
 *
 * For Effect programs, use `@effect/vitest` instead (`*.test.ts` files,
 * `bun run test`). See `stories/11-testing.test.ts` for the canonical
 * Effect test patterns.
 */

import { expect, test } from "bun:test"

test("bun:test smoke — runner picks up *.bun.test.ts files", () => {
  expect(1 + 1).toBe(2)
})
