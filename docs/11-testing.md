# 11 — Testing Effect code

> Story: [`stories/11-testing.test.ts`](../stories/11-testing.test.ts)
> Reference: [`tbiz_ts/packages/api-client/src/__tests__/insurance.test.ts`](../../../works/tbiz_ts/packages/api-client/src/__tests__/insurance.test.ts)

## Toolchain decision

This project runs **two test runners**, picked by what's under test:

| Use case                                | Runner            | Command            | File suffix       |
| --------------------------------------- | ----------------- | ------------------ | ----------------- |
| Effect programs (services, layers, etc) | `@effect/vitest`  | `bun run test`     | `*.test.ts`       |
| Plain unit tests / utilities / shapes   | `bun:test`        | `bun run test:bun` | `*.bun.test.ts`   |

`@effect/vitest` is what effect-solutions recommends for Effect code:

- `it.effect(...)` — auto-runs Effects, auto-provides `TestContext`
- `TestClock` / `TestRandom` for deterministic time/randomness
- `it.live(...)` for real-time tests
- `it.layer(...)` for suite-shared layers (expensive shared resources)
- Automatic `Scope` cleanup
- Detailed fiber dumps on failure

`bun:test` is kept for non-Effect tests because it's fast, zero-config, and
matches the project's Bun-first ethos. The two runners coexist via the
`vitest.config.ts` exclude rule (`*.bun.test.ts` is reserved for bun:test).

The **canonical assertion shape** for schemas is the same in either tool:
decode with `decodeUnknownExit`, assert on `Exit.isSuccess` /
`Exit.isFailure`.

## Schema tests

Pure decode — no Effect runtime needed. Plain `it(...)` is fine:

```ts
import { describe, expect, it } from "@effect/vitest"
import { Exit, Schema } from "effect"

describe("Country schema", () => {
  it("accepts well-formed payload", () => {
    const exit = Schema.decodeUnknownExit(Country)({
      alpha2Code: "ID",
      countrySid: "1001",
    })
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it("rejects too-short alpha2 code", () => {
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

## Effect tests — `it.effect` + `Effect.provide`

Pattern:

1. Define a test-specific layer (hardcoded data, in-memory store, whatever).
2. Write the test body as an Effect via `it.effect("name", () => Effect.gen(...))`.
3. Provide dependencies inline with `.pipe(Effect.provide(layer))`.
4. Done — no `ManagedRuntime`, no `runPromise`, no `dispose`.

The effect-solutions convention for test layers: expose a `testLayer` static
on the service class, or a `makeTestLayer(seed)` helper when you need
parameterization.

```ts
import { describe, expect, it } from "@effect/vitest"
import { Context, Effect, Layer, Schema } from "effect"

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

it.effect("returns a user when it exists", () =>
  Effect.gen(function* () {
    const users = yield* Users
    const user = yield* users.get("1")
    expect(user).toEqual({ id: "1", name: "Ridho" })
  }).pipe(Effect.provide(Users.makeTestLayer({ "1": "Ridho" }))),
)
```

## Asserting on typed errors

Use `Effect.exit(...)` to capture the failure as an `Exit`, then narrow:

```ts
it.effect("fails with a typed NotFound", () =>
  Effect.gen(function* () {
    const users = yield* Users
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
```

## Suite-shared layers — `it.layer`

When a layer is expensive (database, container, real HTTP server) and you
want a single instance across a `describe` block, hoist it with `it.layer`:

```ts
const expensiveLayer = Layer.scoped(...)

describe("DB suite", () => {
  it.layer(expensiveLayer)(({ it }) => {
    it.effect("does the thing", () =>
      Effect.gen(function* () { ... })
    )
  })
})
```

Since beta.67, `@effect/vitest` **forks the memo map for nested `it.layer` suites** — sibling suites no longer share each other's layer setup, while a parent layer is still shared down into its children. So nesting `it.layer` blocks now isolates sibling state correctly; you can build a shared base in an outer `it.layer` and layer per-suite overrides inside without cross-contamination.

## TestClock — deterministic time

`it.effect` automatically provides `TestContext`, which includes a
`TestClock` that starts at `0`:

```ts
import { TestClock } from "effect/testing"

it.effect("delays resolve via TestClock", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.delay(Effect.succeed("done"), "10 seconds").pipe(
      Effect.forkChild,
    )
    yield* TestClock.adjust("10 seconds")
    const result = yield* Fiber.join(fiber)
    expect(result).toBe("done")
  }),
)
```

For real-clock tests, switch to `it.live(...)`.

Because `it.effect` always provides an ambient `Scope`, `TestClock.adjust` works here as shown. Note for non-`it.effect` setups: beta.70 fixed `TestClock` adjustment when the `TestClock` *layer* is provided to a program run **without** an ambient `Scope` — previously that path could fail to advance. Inside `@effect/vitest`'s `it.effect`/`it.layer` you always have a Scope, so you're on the safe path by default.

## When to fall back to `bun:test`

Use `bun:test` (file suffix `*.bun.test.ts`) for:

- Pure-function unit tests with no Effect involvement
- Snapshot/data-shape assertions where pulling in vitest is overkill
- Bun-specific APIs (e.g. `bun:sqlite` integration probes)

Anything that calls `runPromise`, `runSync`, or builds a `ManagedRuntime`
should be written under `@effect/vitest` instead — that runner handles all
of it for you.

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
```

## Testing HttpApi handlers without a server: `HttpApiTest`

beta.63 added `HttpApiTest.groups` under `effect/unstable/httpapi`. It builds an `HttpApiClient` that dispatches through an in-memory `HttpClient` wired straight to `HttpApiBuilder.layer(api)` — no port, no server lifecycle. baseUrl is configurable (default `"http://localhost:3000"`, b66).

Conceptually:

```ts
import { HttpApiBuilder, HttpApiTest } from "effect/unstable/httpapi"
// platform layer comes from your runtime — e.g.
//   @effect/platform-node:    NodeHttpServer.layerHttpServices
//   @effect/platform-bun:     BunHttpServer.layerHttpServices
import { NodeHttpServer } from "@effect/platform-node"

it.effect("groups.findById returns the seeded group", () =>
  Effect.gen(function* () {
    const client = yield* HttpApiTest.groups(Api, ["groups"])
    const result = yield* client.groups.findById({ params: { id: 1 } })
    expect(result).toEqual(new Group({ id: 1, name: "foo" }))
  }).pipe(
    Effect.provide([
      NodeHttpServer.layerHttpServices,
      // The handlers you want exercised live in this group:
      HttpApiBuilder.group(Api, "groups", (h) =>
        h
          .handle("findById", () => Effect.succeed(new Group({ id: 1, name: "foo" })))
          .handle("create",   () => Effect.die("unimplemented"))),
    ]),
  ),
)
```

- Pass the group names you want "live" — every other group's endpoints are auto-stubbed with `Effect.die("Unhandled endpoint: …")`. This isolates the unit under test.
- A platform layer (`platform-node` or `platform-bun`) supplies `FileSystem`, `HttpPlatform`, `Path`, and the etag `Generator` that `HttpApiBuilder.layer` needs. The storybook doesn't ship one yet — add `@effect/platform-bun` and pull in `BunHttpServer.layerHttpServices` when you build out the HttpApi server story.

Reference: `packages/platform-node/test/HttpApi.test.ts` in the upstream `effect-smol` clone.

## Takeaways

- `@effect/vitest` is the default for Effect tests — `it.effect` + `Effect.provide`.
- `bun:test` (with the `*.bun.test.ts` suffix) is kept for plain unit tests.
- `decodeUnknownExit` + `Exit.isSuccess/isFailure` is the schema test shape, in either runner.
- For typed-error assertions inside `it.effect`, lift to an `Exit` with `Effect.exit(...)`, then `Cause.findErrorOption`.
- Reach for `it.layer` (suite-shared layers) and `TestClock` (deterministic time) when you need them — both come for free with `@effect/vitest`.
- `HttpApiTest.groups` (b63) tests HttpApi handlers in-memory; needs a platform layer for the etag/filesystem services.
