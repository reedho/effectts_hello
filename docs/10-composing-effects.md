# 10 — Composing effects

> Story: [`stories/10-composing-effects.ts`](../stories/10-composing-effects.ts)
> Reference: [`tbiz_ts/packages/api-client/src/example/qln_demo.ts`](../../../works/tbiz_ts/packages/api-client/src/example/qln_demo.ts)

A grab-bag of the combinators you'll reach for daily — plus the one function-declaration form effect-solutions recommends for all Effect-returning functions: `Effect.fn`.

## `Effect.fn` — named, traced, instrumented

```ts
const loadUser = Effect.fn("loadUser")(function* (id: string) {
  yield* Effect.sleep("10 millis")
  return { id, name: "Ridho" }
})
```

Benefits:

- **Span** named `loadUser` — picked up automatically by OpenTelemetry.
- **Call-site trace** — stack shows where this was invoked from, not just defined.
- **Cleaner signature** than `(id: string) => Effect.gen(function* () { ... })`.

### The two-argument form: build-in instrumentation

```ts
const fetchFlaky = Effect.fn("fetchFlaky")(
  function* (url: string) {
    yield* Effect.sleep(Duration.millis(5))
    return { url, ok: true }
  },
  // Cross-cutting: every invocation retries + times out
  (self) =>
    self.pipe(
      Effect.timeout(Duration.seconds(2)),
      Effect.retry(Schedule.recurs(3)),
    ),
)
```

Clean way to attach retry/timeout/span without nesting the body in another pipe. You'll use this everywhere once it clicks.

## `Effect.all` — run many, collect results

Record input → record output (nicest for readability):

```ts
const combined = Effect.all(
  { user: fetchUser, orgs: fetchOrgs, prefs: fetchPrefs },
  { concurrency: "unbounded" },
)
// Effect<{ user: User; orgs: Org[]; prefs: Prefs }, E>
```

Array input → array output works too. The `{ concurrency }` option controls parallelism: `"unbounded"`, a number, or `"sequential"` (default).

## `Effect.forEach` — iterate with concurrency

```ts
Effect.forEach([1, 2, 3, 4, 5], fetchOne, { concurrency: 3 })
```

Use over `Promise.all(items.map(fn))` — you keep typed errors and fiber-level cancellation.

## `Effect.tap` — observe without changing the value

```ts
const traced = pipe(
  fetchUser,
  Effect.tap((u) => Console.log(`→ got user ${u.id}`)),
  Effect.map((u) => u.name),
)
```

Siblings: `tapError`, `tapCause`, `tapDefect`, `tapErrorTag`.

## `Effect.cachedWithTTL` — memoize

The access-token fetch from `qln_demo.ts`:

```ts
const demoCache = Effect.gen(function* () {
  const getToken = yield* Effect.cachedWithTTL(slowAuth, Duration.seconds(5))

  const a = yield* getToken
  const b = yield* getToken   // cache hit
  const c = yield* getToken   // still cached
  return { a, b, c }
})
```

The outer Effect **returns an Effect** — call `cachedWithTTL` once, reuse the returned Effect. Calling it repeatedly builds a fresh cache each time.

## `Effect.retry` + `Schedule`

```ts
const retried = pipe(
  flaky,
  Effect.retry(
    pipe(
      Schedule.exponential(Duration.millis(10)),
      Schedule.both(Schedule.recurs(5)),
    ),
  ),
)
```

Common constructors: `Schedule.recurs(n)`, `Schedule.fixed(d)`, `Schedule.exponential(d)`, `Schedule.fibonacci(d)`, `Schedule.spaced(d)`.

Combinators: `Schedule.both(a, b)` (intersection — both must continue), `Schedule.either(a, b)`, `Schedule.andThen(a, b)`, `Schedule.addDelay(fn)`.

### beta.57 note

`Schedule.intersect` from older docs is `Schedule.both` in this version.

## `Effect.withSpan` — ad-hoc tracing

```ts
const spanned = pipe(
  someEffect,
  Effect.withSpan("checkout.total", { attributes: { userId, cart: "..." } }),
)
```

For ad-hoc spans without wrapping in `Effect.fn`. Useful when the function is defined elsewhere and you just want a span around the call.

## Retry only on specific tagged errors

The exponential + bounded schedule above retries *every* failure. Real services want to retry **transient** failures (network, 503, rate-limit) but fail fast on **terminal** ones (auth, validation). The options form of `Effect.retry` accepts a `while:` predicate over the error:

```ts
flakyTyped.pipe(
  Effect.retry({
    schedule: pipe(
      Schedule.exponential(Duration.millis(10)),
      Schedule.both(Schedule.recurs(5)),
    ),
    while: (e) => e._tag === "Transient",
  }),
)
```

`Transient` errors get up to 5 exponential retries; the moment a `Terminal` shows up, retries stop and the failure propagates. The `while` predicate runs against the typed error channel, so it composes cleanly with `Schema.TaggedErrorClass`-shaped errors. Runnable example: `stories/10-composing-effects.ts` section 5b.

## When to use what

- **`Effect.fn("Name")(function* () { ... }, flow?)`** — named service methods, functions you want traced. **This is the recommended default** for Effect-returning functions.
- **`Effect.gen(function* () { ... })`** — anonymous blocks, throwaway sequencing.
- **`pipe(x, decorator1, decorator2)`** — decorating a single value with cross-cutting concerns (map, catchTag, tap, retry, provide).

The typical split in production code: `Effect.fn` at the function declaration level (one span per method), `Effect.gen` for the generator body inside, `pipe` outside for retries/timeouts/catches that apply to the whole body.

## Sequential fallback: `Effect.firstSuccessOf`

Ported back from v3 in beta.61. Walks an iterable in order, returns the first success. If every effect fails, fails with the **last** error. Useful for prioritized sources — primary API → secondary → cache.

```ts
const primary   = Effect.fail(new Error("primary unavailable"))
const secondary = Effect.succeed("secondary result")
const tertiary  = Effect.sync(() => { throw new Error("never reached") })

Effect.firstSuccessOf([primary, secondary, tertiary])
// Effect<string, Error>  — runs `primary`, then `secondary` (succeeds), stops.
```

Distinct from neighbouring patterns:

- **`Effect.race(...)`** — parallel, returns whichever finishes first (winner takes all).
- **`effect.pipe(Effect.orElse(() => fallback))`** — binary; chain N together by hand.

Edge case: an empty iterable defects with `"Received an empty collection of effects"`. Build the list dynamically (e.g. one entry per configured endpoint) and you'll see this if all entries get filtered out.

## Observing retries: `Schedule.tap` (beta.71)

`Schedule.tap` runs an effect for **every schedule decision** without altering the schedule's inputs or outputs — drop it onto any retry/repeat policy to log or emit metrics on backoff, leaving the retried effect untouched.

```ts
const observed = Schedule.exponential("10 millis").pipe(
  Schedule.both(Schedule.recurs(5)),
  Schedule.tap((meta) =>
    Console.log(`attempt ${meta.attempt}: next delay ${Duration.toMillis(meta.duration)}ms`)
  ),
)

Effect.retry(flaky, observed)
```

The callback receives the full `Metadata` — `attempt`, `output`, the computed `duration` (next delay), and `elapsed` timing. (`Schedule.tapInput` / `Schedule.tapOutput` exist for narrower observation.)

## Optional effectful steps: `Effect.transposeOption` (beta.84)

When a step is both **optional** and **effectful** you get an `Option<Effect<A>>`. `Effect.transposeOption` flips it into a single `Effect<Option<A>>` you can yield once:

```ts
Effect.transposeOption(Option.some(Effect.succeed("value")))  // Effect<Option<"value">> → Some("value")
Effect.transposeOption(Option.none())                          // Effect<Option<never>>   → None (effect never runs)
```

`None` short-circuits to `Effect.succeed(None)` — the inner effect runs only in the `Some` branch. Cleaner than `Option.match`-ing by hand to decide whether to run the effect.

## Random elements: `Random.choice` (beta.85)

`Random.choice` picks a random element from an iterable through the Effect `Random` service, so it's **reproducible under `TestRandom`** (see chapter 11) — unlike `Math.random()`.

```ts
Random.choice(["us-east", "us-west", "eu-central"] as const)  // Effect<"us-east" | "us-west" | "eu-central">
```

For a non-empty array the result is `Effect<A>`; for a general iterable it's `Effect<A, NoSuchElementError>` (an empty input fails).

## Takeaways

- `Effect.fn` first — spans, call-site traces, clean signatures.
- `Effect.all` for heterogeneous parallel work; `Effect.forEach` for homogeneous.
- `Effect.tap` for logging and metrics.
- `Effect.cachedWithTTL` for "auth once, reuse" patterns.
- `Schedule.exponential + both(recurs(n))` covers most retry policies; add `Schedule.tap` to observe backoff.
- `Effect.firstSuccessOf` for prioritized-fallback patterns (primary → secondary → cache).
- `Effect.transposeOption` to run an optional effect; `Random.choice` for reproducible random picks.
- `Effect.fn` inside, `pipe` outside.
