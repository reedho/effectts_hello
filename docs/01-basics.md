# 01 — Effect basics

> Story: [`stories/01-basics.ts`](../stories/01-basics.ts)

## The mental model

An `Effect<A, E, R>` is a **description** of a computation. Three type parameters:

- `A` — the success type
- `E` — the typed error type
- `R` — the required services (dependencies) — usually `never` at the edges

Crucially, an Effect **does not run on construction**. Nothing happens until you pass it to one of the `run*` functions. That's what gives Effect its composability: you build a program up as pure data, then run it once at the top level.

## Building effects

```ts
const hello = Effect.succeed("Hello")    // Effect<string, never, never>
const boom  = Effect.fail("nope")        // Effect<never, string, never>
```

Lift a throwing function or Promise:

```ts
const parsed = Effect.try({
  try: () => JSON.parse(input),
  catch: (e) => new Error(`bad json: ${e}`),
})

const fetched = Effect.tryPromise({
  try: () => fetch(url).then(r => r.json()),
  catch: (e) => new Error(`fetch failed: ${e}`),
})
```

The `catch` arm is where untyped throws become typed errors in the `E` channel.

## Running effects

```ts
Effect.runSync(hello)            // string        — synchronous only
await Effect.runPromise(hello)   // Promise<string>
```

If an Effect fails, `runSync`/`runPromise` throw. For a safer, inspectable result, use `runPromiseExit` (covered in chapter 8).

## `Effect.gen` — the preferred body style

Read it as "async/await, but for `Effect`":

```ts
const program = Effect.gen(function* () {
  const name = yield* Effect.succeed("Ridho")
  const greeting = yield* Effect.succeed(`Hi, ${name}!`)
  return greeting
})
```

Every `yield*` unwraps one Effect. On failure, the generator short-circuits — the rest of the body doesn't run, and the outer Effect carries the error.

**Why this style?** In v4, services are tags that can *only* be consumed via `yield* MyService` inside `Effect.gen`. You can't `pipe(tag, Effect.flatMap(...))` anymore. So you'll end up writing `Effect.gen` constantly — might as well start with it.

## `Effect.fn` — the preferred *function* style

For any Effect-returning function you'd otherwise declare as `const x = (args) => Effect.gen(...)`, **effect-solutions recommends** wrapping in `Effect.fn`:

```ts
const loadUser = Effect.fn("loadUser")(function* (id: string) {
  yield* Effect.sleep("10 millis")
  return { id, name: "Ridho" }
})
```

Benefits:

- **Call-site trace** — when this Effect fails, the stack shows where it was *invoked*, not just where it was defined.
- **Telemetry span** — the string name becomes a span automatically (OpenTelemetry and friends pick it up).
- **Cleaner signature** — no explicit `Effect.gen(function*…)` wrapper.

The two-argument form adds cross-cutting instrumentation without nesting the body:

```ts
const fetchFlaky = Effect.fn("fetchFlaky")(
  function* (url: string) { /* ... */ },
  (self) => self.pipe(
    Effect.timeout(Duration.seconds(2)),
    Effect.retry(Schedule.recurs(3)),
  ),
)
```

You'll see `Effect.fn` all over the service-method examples in chapter 5.

## Failure is a value

The key shift from try/catch is that failures flow through the same pipeline as successes. You handle them with combinators, not with control flow.

```ts
const boom = Effect.fail("kaboom")

// Fold both channels into a plain value:
const safe = boom.pipe(
  Effect.match({
    onFailure: (err) => `recovered: ${err}`,
    onSuccess: (ok)  => `ok: ${ok}`,
  })
)
// safe: Effect<string, never, never>
```

### Version note (v4-beta.57)

There is **no** `Effect.catchAll` in the version you're running. The replacements are:

- `Effect.match` / `Effect.matchEffect` — fold both channels into a single value
- `Effect.catchCause` — catch everything (including defects)
- `Effect.catchTag` — catch *one specific* tagged error (chapter 4)

If you see `Effect.catchAll` in older docs or in `tbiz_ts` code (which targets beta.31), treat it as an alias for one of the above depending on intent.

## What's next

Chapter 2 moves on to modeling data — the other half of every Effect program. You'll switch from `Schema.Struct` to `Schema.Class` and start branding every domain primitive.
