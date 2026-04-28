/**
 * 11 — Testing Effect code with `@effect/vitest`.
 *
 * **Tooling note.** effect-solutions recommends `@effect/vitest` for Effect
 * tests because it provides:
 *   - `it.effect` — auto-runs Effects, auto-provides `TestContext`
 *   - `TestClock` / `TestRandom` for deterministic time/randomness
 *   - Automatic `Scope` cleanup (no manual `runtime.dispose()`)
 *   - `it.live`, `it.layer`, fiber-aware failure dumps
 *
 * The project root says "use bun test" — that still applies for plain unit
 * tests (utility funcs, data shapes, pure assertions). For anything that
 * runs an Effect, prefer `@effect/vitest`. The split is documented in
 * CLAUDE.md and `package.json` exposes both runners:
 *   - `bun run test`      → vitest (this file and any `*.test.ts` in stories/)
 *   - `bun run test:bun`  → bun:test (any `*.bun.test.ts` files)
 *
 * Run this file: `bun run test stories/11-testing.test.ts`
 */

import { describe, expect, it } from "@effect/vitest"
import { Cause, Context, Effect, Exit, Layer, Option, Schema } from "effect"

/* ========================================================================= */
/* Schema tests — pure decode, no Effect runtime needed                      */
/* ========================================================================= */
/*
 * Plain `it(...)` is fine here. `decodeUnknownExit` returns an `Exit` value;
 * we assert on `Exit.isSuccess` / `Exit.isFailure`. No `try/catch` noise.
 */

const Country = Schema.Struct({
  alpha2Code: Schema.String.pipe(Schema.check(Schema.isMinLength(2))),
  countrySid: Schema.String,
})

describe("Country schema", () => {
  it("accepts well-formed payload", () => {
    const exit = Schema.decodeUnknownExit(Country)({
      alpha2Code: "ID",
      countrySid: "1001",
    })
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("rejects missing field", () => {
    const exit = Schema.decodeUnknownExit(Country)({ countrySid: "1001" })
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("rejects too-short alpha2 code", () => {
    const exit = Schema.decodeUnknownExit(Country)({
      alpha2Code: "X",
      countrySid: "1001",
    })
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("extracts typed data on success", () => {
    const exit = Schema.decodeUnknownExit(Country)({
      alpha2Code: "ID",
      countrySid: "1001",
    })
    if (Exit.isSuccess(exit)) {
      expect(exit.value.alpha2Code).toBe("ID")
    } else {
      throw new Error("expected success")
    }
  })
})

/* ========================================================================= */
/* Effect tests — `it.effect` runs the Effect and provides TestContext       */
/* ========================================================================= */

class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", {
  id: Schema.String,
}) {}

interface UsersShape {
  readonly get: (id: string) => Effect.Effect<{ id: string; name: string }, NotFound>
}
class Users extends Context.Service<Users, UsersShape>()("test/Users") {
  // effect-solutions convention: expose `testLayer` (or `makeTestLayer(seed)`)
  // on the service class. The test composes layers via `Effect.provide`.
  static readonly makeTestLayer = (db: Record<string, string>) =>
    Layer.succeed(Users)({
      get: (id) =>
        db[id]
          ? Effect.succeed({ id, name: db[id] as string })
          : Effect.fail(new NotFound({ id })),
    })
}

describe("Users service", () => {
  it.effect("returns a user when it exists", () =>
    Effect.gen(function* () {
      const users = yield* Users
      const user = yield* users.get("1")
      expect(user).toEqual({ id: "1", name: "Ridho" })
    }).pipe(Effect.provide(Users.makeTestLayer({ "1": "Ridho" }))),
  )

  it.effect("fails with a typed NotFound", () =>
    Effect.gen(function* () {
      const users = yield* Users
      // We want to assert on the failure, so capture it as an Exit instead
      // of letting it propagate.
      const exit = yield* Effect.exit(users.get("missing"))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.findErrorOption(exit.cause)
        expect(Option.isSome(err)).toBe(true)
        if (Option.isSome(err)) {
          expect(err.value._tag).toBe("NotFound")
          expect(err.value.id).toBe("missing")
        }
      }
    }).pipe(Effect.provide(Users.makeTestLayer({}))),
  )
})

/* ========================================================================= */
/* Why this shape?                                                           */
/* ========================================================================= */
/*
 *  - `decodeUnknownExit` over `decodeUnknownSync`: `Sync` throws a
 *    SchemaError. Wrapping every test in try/catch is noisy. `Exit` is a
 *    plain value: assert with `Exit.isSuccess` / `Exit.isFailure`.
 *
 *  - `it.effect` over manual `ManagedRuntime.make` + `runPromise` +
 *    `dispose`: auto-runs the Effect, auto-provides TestContext (TestClock,
 *    TestRandom), auto-closes the scope. You only write the program.
 *
 *  - `Effect.exit(eff)` to inspect a failure: lifts the failure into an
 *    Exit value so we can narrow with `Exit.isFailure(...)` and pull the
 *    typed error via `Cause.findErrorOption`.
 *
 *  - `Effect.provide(layer)` at the tail: provides dependencies inline.
 *    For suite-shared expensive layers (e.g. a database container), use
 *    `it.layer(layer)(({ it }) => { ... })` instead.
 *
 * Reference real-world tests:
 *   `tbiz_ts/packages/api-client/src/__tests__/insurance.test.ts`
 */
