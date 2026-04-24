# 11 — Testing Effect code

> Story: [`stories/11-testing.test.ts`](../stories/11-testing.test.ts)
> Reference: [`tbiz_ts/packages/api-client/src/__tests__/insurance.test.ts`](../../../works/tbiz_ts/packages/api-client/src/__tests__/insurance.test.ts)

## Toolchain decision

effect-solutions recommends **`@effect/vitest`** for Effect tests. It gives you:

- `it.effect(...)` — auto-runs Effects and auto-provides `TestContext`
- `TestClock` / `TestRandom` for deterministic time/randomness
- `it.live(...)` for real-time tests
- `it.layer(...)` for suite-shared layers (expensive shared resources)
- Automatic scope cleanup
- Detailed fiber dumps on failure

This project uses **`bun:test`** because CLAUDE.md requires it. You lose the above. For simple tests it doesn't matter; if you need deterministic time or scope cleanup, add `@effect/vitest` as a project exception and co-locate its tests separately.

The **canonical assertion shape is identical** in either tool. The examples below port one-to-one.

## Schema tests

Assert on `Exit.isSuccess` / `Exit.isFailure`. Don't wrap `decodeUnknownSync` in try/catch:

```ts
import { Exit, Schema } from "effect"

describe("Country schema", () => {
  test("accepts well-formed payload", () => {
    const exit = Schema.decodeUnknownExit(Country)({
      alpha2Code: "ID",
      countrySid: "1001",
    })
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("rejects too-short alpha2 code", () => {
    const exit = Schema.decodeUnknownExit(Country)({
      alpha2Code: "X",
      countrySid: "1001",
    })
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
```

Narrow with `Exit.isSuccess(exit)` and read `exit.value`:

```ts
if (Exit.isSuccess(exit)) {
  expect(exit.value.alpha2Code).toBe("ID")
} else {
  throw new Error("expected success")
}
```

## Effect tests — run against a test layer

Pattern:

1. Construct a test-specific layer (hardcoded data, in-memory store, whatever).
2. Build a `ManagedRuntime` from it.
3. Run with `runPromise` (happy) or `runPromiseExit` (error assertions).
4. Dispose in cleanup.

The effect-solutions convention for test layers: expose a `testLayer` static on the service class, or a `makeTestLayer(seed)` helper when you need parameterization.

```ts
class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", {
  id: Schema.String,
}) {}

class Users extends Context.Service<Users, UsersShape>()("test/Users") {
  static readonly makeTestLayer = (db: Record<string, string>) =>
    Layer.succeed(Users)({
      get: (id) =>
        db[id]
          ? Effect.succeed({ id, name: db[id] })
          : Effect.fail(new NotFound({ id })),
    })
}

test("returns a user when it exists", async () => {
  const runtime = ManagedRuntime.make(Users.makeTestLayer({ "1": "Ridho" }))

  const result = await runtime.runPromise(
    Effect.gen(function* () {
      const users = yield* Users
      return yield* users.get("1")
    }),
  )

  expect(result).toEqual({ id: "1", name: "Ridho" })
  await runtime.dispose()
})
```

## Asserting on typed errors

```ts
test("fails with a typed NotFound", async () => {
  const runtime = ManagedRuntime.make(Users.makeTestLayer({}))

  const exit = await runtime.runPromiseExit(
    Effect.gen(function* () {
      const users = yield* Users
      return yield* users.get("missing")
    }),
  )

  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    const err = Cause.findErrorOption(exit.cause)
    expect(Option.isSome(err)).toBe(true)
    if (Option.isSome(err)) {
      expect(err.value._tag).toBe("NotFound")
      expect(err.value.id).toBe("missing")
    }
  }

  await runtime.dispose()
})
```

## What `@effect/vitest` would add

For comparison, the same tests under `@effect/vitest` look like:

```ts
import { describe, expect, it } from "@effect/vitest"

describe("Users service", () => {
  it.effect("returns a user", () =>
    Effect.gen(function* () {
      const users = yield* Users
      expect(yield* users.get("1")).toEqual({ id: "1", name: "Ridho" })
    }).pipe(Effect.provide(Users.makeTestLayer({ "1": "Ridho" })))
  )
})
```

Key differences:

- No `runPromise` / `dispose` calls — handled for you.
- `it.effect` auto-provides `TestClock`, `TestRandom`, scopes.
- Deterministic time: `yield* TestClock.adjust("10 seconds")` instead of real `setTimeout`.

If you hit a test that needs `TestClock` or scoped cleanup under `bun:test`, it's a signal to bring in `@effect/vitest` — you'll end up re-implementing its surface otherwise.

## Helper ideas

Patterns worth extracting once you've written a few tests:

```ts
// Expect a tagged failure and return the typed error
function expectTagged<E extends { _tag: string }>(
  exit: Exit.Exit<unknown, E>,
  tag: E["_tag"],
): E {
  if (!Exit.isFailure(exit)) throw new Error(`expected failure, got success`)
  const err = Cause.findErrorOption(exit.cause)
  if (!Option.isSome(err)) throw new Error(`expected a typed error`)
  if (err.value._tag !== tag) {
    throw new Error(`expected _tag="${tag}", got "${err.value._tag}"`)
  }
  return err.value
}

// Run an Effect against a layer and await the Exit
async function runExit<R, A, E>(
  layer: Layer.Layer<R, never, never>,
  effect: Effect.Effect<A, E, R>,
): Promise<Exit.Exit<A, E>> {
  const rt = ManagedRuntime.make(layer)
  try {
    return await rt.runPromiseExit(effect)
  } finally {
    await rt.dispose()
  }
}
```

## Takeaways

- `decodeUnknownExit` + `Exit.isSuccess/isFailure` is the schema test shape.
- For Effect programs: build a test layer, ManagedRuntime, run, assert, dispose.
- `runPromiseExit` + `Cause.findErrorOption` for typed-error assertions.
- If tests need `TestClock` or auto-scope, reach for `@effect/vitest` — `bun:test` can't express those.
