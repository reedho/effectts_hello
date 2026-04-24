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

## When to use what

- **`Effect.fn("Name")(function* () { ... }, flow?)`** — named service methods, functions you want traced. **This is the recommended default** for Effect-returning functions.
- **`Effect.gen(function* () { ... })`** — anonymous blocks, throwaway sequencing.
- **`pipe(x, decorator1, decorator2)`** — decorating a single value with cross-cutting concerns (map, catchTag, tap, retry, provide).

The typical split in production code: `Effect.fn` at the function declaration level (one span per method), `Effect.gen` for the generator body inside, `pipe` outside for retries/timeouts/catches that apply to the whole body.

## Takeaways

- `Effect.fn` first — spans, call-site traces, clean signatures.
- `Effect.all` for heterogeneous parallel work; `Effect.forEach` for homogeneous.
- `Effect.tap` for logging and metrics.
- `Effect.cachedWithTTL` for "auth once, reuse" patterns.
- `Schedule.exponential + both(recurs(n))` covers most retry policies.
- `Effect.fn` inside, `pipe` outside.
