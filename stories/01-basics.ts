/**
 * 01 — Effect basics: generators, run functions, failure vs. success.
 *
 * `Effect<A, E, R>` is a lazy description of a computation that:
 *   - may produce value of type `A`
 *   - may fail with a typed error `E`
 *   - may require services of type `R` (dependencies)
 *
 * Nothing runs until you call one of the `run*` functions.
 *
 * Run with: `bun stories/01-basics.ts`
 */

import { Effect } from "effect";

/* ---------- 1. The simplest Effect ---------------------------------------- */

const hello = Effect.succeed("Hello from Effect");
// hello: Effect<string, never, never>

/* ---------- 2. Running an Effect ------------------------------------------ */

console.log("1) runSync:", Effect.runSync(hello));

// For Effects that may be async, use runPromise:
await Effect.runPromise(Effect.succeed("Hello via Promise")).then((s) =>
  console.log("2) runPromise:", s),
);

/* ---------- 3. Effect.gen — the preferred style --------------------------- *
 * Think of it as async/await, but for Effect. Every `yield*` unwraps an
 * Effect and gives you the success value (or short-circuits on failure).
 *
 * In tbiz_ts this is the dominant style; see packages/api-client/src/qilin/common.ts.
 */

const greet = Effect.gen(function* () {
  const name = yield* Effect.succeed("Ridho");
  const greeting = yield* Effect.succeed(`Hi, ${name}!`);
  return greeting;
});

console.log("3) Effect.gen:", Effect.runSync(greet));

/* ---------- 4. Failure is a value, not an exception ----------------------- *
 * In v4-beta.57 there is no `Effect.catchAll`. Use `Effect.match` to fold
 * both channels into a plain value, or `Effect.catchTag` for a specific
 * tagged error (shown in story 04).
 */

const boom: Effect.Effect<never, string, never> = Effect.fail("kaboom");

const recovered = boom.pipe(
  Effect.match({
    onFailure: (err) => `recovered from: ${err}`,
    onSuccess: (ok) => `ok: ${ok}`,
  }),
);

console.log("4) recovered:", Effect.runSync(recovered));

/* ---------- 5. Effect.try / tryPromise — lifting throwing code ------------ *
 * Lift a throw-y function (or Promise) into the Effect world.
 * Pattern lifted from packages/auth/src/auth.ts.
 */

const parsed = Effect.try({
  try: () => JSON.parse('{"ok": true}') as { ok: boolean },
  catch: (e) => new Error(`bad json: ${String(e)}`),
});

const fetched = Effect.tryPromise({
  try: () => Promise.resolve(42),
  catch: (e) => new Error(`fetch failed: ${String(e)}`),
});

const program = Effect.gen(function* () {
  const obj = yield* parsed;
  const n = yield* fetched;
  return { ...obj, n };
});

console.log("5) try + tryPromise:", await Effect.runPromise(program));

/* ---------- 6. Why `yield*` instead of `pipe + flatMap`? ------------------ *
 *
 * In v4, service tags (Context.Service — called ServiceMap.Service in older
 * betas) are **not** Effect values. You can't write
 * `pipe(MyService, Effect.flatMap(...))`. You *must* use `yield* MyService`
 * inside Effect.gen. See EFFECT_V4_MIGRATION.md §2.
 */

/* ---------- 7. Effect.fn — named, traced effectful functions ------------- *
 * effect-solutions recommends using `Effect.fn("Name")(function* () { ... })`
 * for any Effect-returning function you'd otherwise declare with a plain
 * arrow. Benefits:
 *   - Call-site trace (knows where the function was *invoked* from)
 *   - A telemetry span named "Name" (great for OpenTelemetry)
 *   - Cleaner signature — no explicit `Effect.gen(function*…)` wrapper
 *
 * You'll see this all over the later stories for service methods.
 */

const loadUser = Effect.fn("loadUser")(function* (id: string) {
  yield* Effect.sleep("10 millis");
  return { id, name: "Ridho" };
});

console.log("7) Effect.fn:", await Effect.runPromise(loadUser("u-1")));
