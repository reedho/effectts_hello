/**
 * 10 — Composing effects: all, forEach, tap, cached, retry.
 *
 * Building programs out of smaller Effects. Borrows the shape of
 * `qln_demo.ts` (cached access token) and the general composition style
 * used across api-client.
 *
 * Run: `bun stories/10-composing-effects.ts`
 */

import { Console, Duration, Effect, Schedule, Schema, pipe } from "effect";

/* ---------- 1. Effect.all — run many in parallel ------------------------- *
 * With a record input you get a record back (great for readability).
 */

const fetchUser = Effect.succeed({ id: "u1", name: "Ridho" });
const fetchOrgs = Effect.succeed(["acme", "globex"]);
const fetchPrefs = Effect.succeed({ theme: "dark" });

const combined = Effect.all(
  {
    user: fetchUser,
    orgs: fetchOrgs,
    prefs: fetchPrefs,
  },
  { concurrency: "unbounded" },
);

console.log("1) Effect.all (record):", Effect.runSync(combined));

/* ---------- 2. Effect.forEach — iterate with concurrency control --------- */

const fetchOne = (id: number) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(50));
    return { id, name: `user-${id}` };
  });

const all = await Effect.runPromise(
  Effect.forEach([1, 2, 3, 4, 5], fetchOne, { concurrency: 3 }),
);
console.log("2) forEach (conc=3):", all.map((u) => u.name).join(","));

/* ---------- 3. Effect.tap — observe without changing the value ----------- */

const traced = pipe(
  fetchUser,
  Effect.tap((u) => Console.log(`→ got user ${u.id}`)),
  Effect.map((u) => u.name),
);

console.log("3) tap + map:", Effect.runSync(traced));

/* ---------- 4. Effect.cachedWithTTL — memoize an Effect ------------------ *
 * From qln_demo.ts: cache the access-token fetch for 5 minutes so you
 * don't re-auth on every call.
 *
 * The outer Effect hands you back a new Effect that, when run, returns
 * either the cached result or (after TTL expires) recomputes.
 */

let calls = 0;
const slowAuth = Effect.gen(function* () {
  calls++;
  yield* Effect.sleep(Duration.millis(20));
  return { token: `tok-${calls}` };
});

const demoCache = Effect.gen(function* () {
  const getToken = yield* Effect.cachedWithTTL(slowAuth, Duration.seconds(5));

  const a = yield* getToken;
  const b = yield* getToken;
  const c = yield* getToken;
  return { a, b, c, callsUnderlying: calls };
});

console.log("4) cachedWithTTL:", await Effect.runPromise(demoCache));
// expect `calls: 1` — cached for the TTL window.

/* ---------- 5. Retries with a Schedule ----------------------------------- *
 * `Effect.retry(effect, schedule)` reruns on failure until the schedule
 * elapses. `Schedule.exponential` combined with `Schedule.recurs(n)` gives
 * you bounded exponential backoff.
 */

let attempts = 0;
const flaky = Effect.gen(function* () {
  attempts++;
  if (attempts < 3) {
    return yield* Effect.fail(new Error("transient"));
  }
  return `ok after ${attempts} attempts`;
});

// `Schedule.both` combines two schedules — the retry continues only while
// *both* are still firing. Here: exponential backoff up to 5 retries.
const retried = pipe(
  flaky,
  Effect.retry(
    pipe(
      Schedule.exponential(Duration.millis(10)),
      Schedule.both(Schedule.recurs(5)),
    ),
  ),
);

console.log("5) retry:", await Effect.runPromise(retried));

/* ---------- 5b. Retry only on specific tagged errors --------------------- *
 * The retry above retries *every* failure. Real services want to retry
 * **transient** failures (network, 503, rate-limit) but fail fast on
 * **terminal** ones (auth, validation, "you said no twice"). The
 * options form of `Effect.retry` accepts a `while:` predicate over the
 * error — combine it with the bounded backoff above so transient errors
 * get up to N exponential retries and terminal errors short-circuit
 * immediately.
 */

class Transient extends Schema.TaggedErrorClass<Transient>()("Transient", {
  message: Schema.String,
}) {}
class Terminal extends Schema.TaggedErrorClass<Terminal>()("Terminal", {
  message: Schema.String,
}) {}

let typedTries = 0;
const flakyTyped: Effect.Effect<string, Transient | Terminal> = Effect.gen(function* () {
  typedTries++;
  if (typedTries === 1) return yield* new Transient({ message: "rate-limit" });
  if (typedTries === 2) return yield* new Terminal({ message: "bad credentials" });
  return "won't reach here";
});

const typedExit = await Effect.runPromiseExit(
  flakyTyped.pipe(
    Effect.retry({
      schedule: pipe(
        Schedule.exponential(Duration.millis(10)),
        Schedule.both(Schedule.recurs(5)),
      ),
      while: (e) => e._tag === "Transient",
    }),
  ),
);
console.log("5b) typed-retry:", typedExit._tag, "after", typedTries, "attempts");
// expect: Failure (Terminal on attempt 2), typedTries == 2

/* ---------- 5c. Effect.firstSuccessOf — sequential fallback -------------- *
 * (Ported from v3 in beta.61.) Walks the iterable in order, returns the
 * first success, and — if every effect fails — fails with the LAST error.
 * Useful for prioritized sources: primary API → secondary → cache.
 *
 * Contrast with:
 *   - `Effect.race` — runs all in parallel, takes whichever finishes first.
 *   - `effect.orElse(fallback)` — only binary; chain N together by hand.
 *
 * Empty iterable defects with "Received an empty collection of effects".
 */

const primary = Effect.fail(new Error("primary unavailable") as Error);
const secondary = Effect.succeed("secondary result");
const tertiary = Effect.sync(() => {
  throw new Error("never evaluated — sequential, short-circuits on first success");
});

console.log("5c) firstSuccessOf:", Effect.runSync(Effect.firstSuccessOf([primary, secondary, tertiary])));
// → "secondary result"; tertiary is never touched.

/* ---------- 6. Effect.fn — the production sweet-spot --------------------- *
 * The effect-solutions recommendation for any function that returns an
 * Effect: wrap it in `Effect.fn("Name")(function* (args) { ... })`. You
 * get:
 *   - a telemetry span named "Name"
 *   - a call-site trace (stack shows where it was *invoked*)
 *   - cleaner signatures than Effect.gen at the top level
 *
 * The `Effect.fn` two-arg form accepts an "instrumentation pipeline" as
 * the second argument — clean way to attach retry/timeout/span without
 * nesting the body.
 */

const fetchFlaky = Effect.fn("fetchFlaky")(
  function* (url: string) {
    yield* Effect.sleep(Duration.millis(5));
    return { url, ok: true };
  },
  // Cross-cutting: every invocation retries + times out
  (self) =>
    self.pipe(
      Effect.timeout(Duration.seconds(2)),
      Effect.retry(Schedule.recurs(3)),
    ),
);

console.log("6) Effect.fn with instrumentation:", await Effect.runPromise(fetchFlaky("/x")));

/* ---------- 7. pipe vs Effect.gen — when to use which -------------------- *
 * `Effect.gen` reads like imperative code and is easiest for sequencing
 * that uses intermediate values.
 *
 * `pipe` reads like a data pipeline and shines when you're decorating a
 * single value with `.map` / `.catchTag` / `.tap` / `.retry`.
 *
 * `Effect.fn("name")(function* () { ... }, flow(...))` — the best of both:
 * generator body + instrumentation pipeline, with a span attached.
 *
 * Teams usually: Effect.fn for named service methods, plain Effect.gen
 * for anonymous blocks, and pipe on the outside to attach cross-cutting
 * behavior (catch, retry, provide, tap). See pegasus.ts /
 * rpc-client/client.ts for the split applied to HTTP clients.
 */

/* ---------- 8. Effect.withSpan — ad-hoc spans ---------------------------- */

const spanned = pipe(
  fetchUser,
  Effect.withSpan("spanned-fetch", { attributes: { why: "demo" } }),
);
void spanned;
