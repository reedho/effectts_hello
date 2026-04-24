# 10 — Composing effects

> Story: [`stories/10-composing-effects.ts`](../stories/10-composing-effects.ts)
> Reference: [`tbiz_ts/packages/api-client/src/example/qln_demo.ts`](../../../works/tbiz_ts/packages/api-client/src/example/qln_demo.ts)

A grab-bag of the combinators you'll reach for daily.

## `Effect.all` — run many, collect results

Record input → record output (nicest for readability):

```ts
const combined = Effect.all(
  { user: fetchUser, orgs: fetchOrgs, prefs: fetchPrefs },
  { concurrency: "unbounded" },
)
// Effect<{ user: User; orgs: Org[]; prefs: Prefs }, E>
```

Array input → array output works too. The `{ concurrency }` option controls parallelism:

- `"unbounded"` — everything in parallel
- a number — bounded pool
- `"sequential"` (default) — one at a time

## `Effect.forEach` — iterate with concurrency

The parallel map:

```ts
Effect.forEach([1, 2, 3, 4, 5], fetchOne, { concurrency: 3 })
// Effect<User[], E>
```

Use this over `Promise.all(items.map(fn))` — you keep typed errors and Fiber-level cancellation. Use it over `Effect.all` when you have an array and want to apply the same function to each element.

## `Effect.tap` — observe without changing the value

```ts
const traced = pipe(
  fetchUser,
  Effect.tap((u) => Console.log(`→ got user ${u.id}`)),
  Effect.map((u) => u.name),
)
```

`tap` runs a side-effecting Effect, then discards its result and passes through the original value. Logging, metrics, debug breakpoints — anywhere the return value would normally get in the way.

Siblings: `tapError`, `tapCause`, `tapDefect`, `tapErrorTag`. Same idea, different channels.

## `Effect.cachedWithTTL` — memoize a computation

The access-token fetch from `qln_demo.ts`:

```ts
const demoCache = Effect.gen(function* () {
  const getToken = yield* Effect.cachedWithTTL(slowAuth, Duration.seconds(5))

  const a = yield* getToken
  const b = yield* getToken   // cache hit
  const c = yield* getToken   // cache hit — still within 5s
  return { a, b, c }
})
```

The outer Effect **returns an Effect** — the cached one. Run that inner Effect as many times as you want; it recomputes after the TTL elapses. Make sure to call `cachedWithTTL` once and reuse the returned Effect; calling it repeatedly builds a new cache each time.

## `Effect.retry` — with a `Schedule`

Retries compose: take a base schedule (how long to wait), combine it with a limit (how many times), and you have a backoff strategy:

```ts
const retried = pipe(
  flaky,
  Effect.retry(
    pipe(
      Schedule.exponential(Duration.millis(10)),   // 10ms, 20ms, 40ms, ...
      Schedule.both(Schedule.recurs(5)),            // stop after 5 retries
    ),
  ),
)
```

Common Schedule constructors:

- `Schedule.recurs(n)` — up to `n` retries, no delay
- `Schedule.fixed(duration)` — constant interval
- `Schedule.exponential(base)` — exponential backoff
- `Schedule.fibonacci(one)` — fibonacci backoff
- `Schedule.spaced(duration)` — constant spacing from the last attempt

Combinators:

- `Schedule.both(a, b)` — continue while **both** still fire (intersection of budgets)
- `Schedule.either(a, b)` — continue if **either** still fires
- `Schedule.andThen(a, b)` — run `a`, then `b`
- `Schedule.addDelay(fn)` — modify the delay between attempts

### v4-beta.57 note

`Schedule.intersect` from older docs is `Schedule.both` in this version. Name aside, semantics are identical.

## `pipe` vs `Effect.gen` — when to use which

Both produce an `Effect`. The difference is ergonomic:

- **`Effect.gen`** reads like imperative code. Best for function *bodies* — threading intermediate values, branching, early returns via `yield* Effect.fail(...)`.
- **`pipe`** reads like a data pipeline. Best for *decorating* a single value: adding `map`, `catchTag`, `retry`, `tap`, `provide` on the outside.

The convention in tbiz_ts (see [`pegasus.ts`](../../../works/tbiz_ts/packages/api-client/src/pegasus.ts) and [`rpc-client/client.ts`](../../../works/tbiz_ts/packages/rpc-client/src/client.ts)):

```ts
const callApi = (...) =>
  Effect.gen(function* () {      // body in gen — linear flow
    const cfg = yield* Config
    const client = yield* HttpClient.HttpClient
    // ...
    return result
  }).pipe(                       // cross-cutting behavior in pipe
    Effect.catchTag("HttpBodyError", ...),
    Effect.catchTag("HttpClientError", ...),
    Effect.retry(policy),
    Effect.provide(LoggingLive),
  )
```

## Takeaways

- `Effect.all` for heterogeneous parallel work; `Effect.forEach` for homogeneous.
- `Effect.tap` for logging and metrics — never lose the value.
- `Effect.cachedWithTTL` is a one-liner for "auth once, reuse" patterns.
- Compose retry policies with `Schedule` — `exponential + both(recurs(n))` covers most cases.
- `Effect.gen` inside, `pipe` outside.
