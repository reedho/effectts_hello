# 11 — Testing Effect code

> Story: [`stories/11-testing.test.ts`](../stories/11-testing.test.ts)
> Reference: [`tbiz_ts/packages/api-client/src/__tests__/insurance.test.ts`](../../../works/tbiz_ts/packages/api-client/src/__tests__/insurance.test.ts)

## Toolchain

tbiz_ts uses `vitest`; this repo uses `bun:test`. For Effect code the assertions are identical — the patterns below port one-to-one.

Run:

```bash
bun test stories/11-testing.test.ts
```

## Schema tests — the canonical shape

Assert on `Exit.isSuccess` / `Exit.isFailure`. Don't wrap `decodeUnknownSync` in try/catch.

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

### Extracting the decoded value on success

Narrow with `Exit.isSuccess(exit)` and read `exit.value`:

```ts
if (Exit.isSuccess(exit)) {
  expect(exit.value.alpha2Code).toBe("ID")
} else {
  throw new Error("expected success")
}
```

The `else throw` is a convenience — if your test got here, `Exit.isSuccess` was `true` in the assertion above, so TypeScript will still narrow inside the guard.

## Effect tests — run against a test Layer

The pattern:

1. Construct a test-specific Layer (hardcoded data, in-memory store, whatever).
2. Build a `ManagedRuntime` from it.
3. Run the program with `runPromise` (happy) or `runPromiseExit` (error assertions).
4. Dispose the runtime in cleanup.

```ts
const makeUsersLayer = (db: Record<string, string>) =>
  Layer.succeed(Users)({
    get: (id) =>
      db[id]
        ? Effect.succeed({ id, name: db[id] })
        : Effect.fail(new NotFound({ id })),
  })

test("returns a user when it exists", async () => {
  const runtime = ManagedRuntime.make(makeUsersLayer({ "1": "Ridho" }))

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

Use `runPromiseExit` and drill into the `Cause`:

```ts
test("fails with a typed NotFound", async () => {
  const runtime = ManagedRuntime.make(makeUsersLayer({}))

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

The nested `if (Option.isSome(err))` is TypeScript being honest — `findErrorOption` returns `Option<E>`. In practice you can wrap this in a small helper.

## Why `decodeUnknownExit` and not `Sync`?

- `Sync` throws a `SchemaError`. Every test becomes `try { ... } catch { ... }`.
- `Exit` is a plain value you assert on. No control flow hacks.
- For error-shape assertions, you can narrow with `Exit.isFailure` and extract typed errors from the `Cause`.

This is the pattern used throughout `packages/api-client/src/__tests__/insurance.test.ts` — dozens of tests, same shape, no exceptions at the boundary.

## Test helper ideas

Once you've written a few tests, patterns emerge. Some helpers worth stealing:

```ts
// Expect a tagged failure and return the typed error
function expectFailure<E>(exit: Exit.Exit<unknown, E>, tag: string): E {
  if (!Exit.isFailure(exit)) throw new Error(`expected failure, got success`)
  const err = Cause.findErrorOption(exit.cause)
  if (!Option.isSome(err)) throw new Error(`expected a typed error`)
  if ((err.value as any)._tag !== tag) {
    throw new Error(`expected _tag="${tag}", got "${(err.value as any)._tag}"`)
  }
  return err.value
}

// Run an Effect against a layer and await the Exit
async function runExit<R, A, E>(
  layer: Layer.Layer<R, never, never>,
  effect: Effect.Effect<A, E, R>,
): Promise<Exit.Exit<A, E>> {
  const rt = ManagedRuntime.make(layer)
  try { return await rt.runPromiseExit(effect) }
  finally { await rt.dispose() }
}
```

## Takeaways

- `decodeUnknownExit` + `Exit.isSuccess/isFailure` is the schema test shape.
- For Effect programs: build a test Layer, ManagedRuntime, run, assert, dispose.
- `runPromiseExit` + `Cause.findErrorOption` exposes typed errors for assertions.
- Write helpers once you repeat a pattern twice.
