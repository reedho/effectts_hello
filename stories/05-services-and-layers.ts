/**
 * 05 — Services and Layers (dependency injection).
 *
 * A **Service** is a typed dependency slot. A **Layer** is a recipe for
 * constructing and wiring services together.
 *
 * ⚠️ tbiz_ts targets effect-beta.31 where the class is `ServiceMap.Service`.
 * This project uses effect-beta.57 where the **identical pattern** is
 * `Context.Service<Self, Shape>()("id")`. Same shape, different module.
 *
 * In **both** versions:
 *   - `Layer.succeed` and `Layer.effect` are **curried**:
 *        `Layer.effect(Tag)(Effect.gen(...))`    ✅
 *        `Layer.effect(Tag, Effect.gen(...))`    ❌ (v3)
 *   - You consume a service with `yield* Tag` inside `Effect.gen`.
 *
 * Run: `bun stories/05-services-and-layers.ts`
 * Real-world: `packages/auth/src/auth.ts`, `packages/api-client/src/qilin.ts`
 */

import { Context, Effect, Layer } from "effect";

/* ---------- 1. Define a service (shape + tag) ---------------------------- *
 * Convention: name the shape `FooShape` and the class tag `Foo`. Can't use
 * the same name for the interface and the class.
 */

interface GreeterShape {
  readonly greet: (name: string) => Effect.Effect<string>;
}

class Greeter extends Context.Service<Greeter, GreeterShape>()("app/Greeter") {}

/* ---------- 2. Provide an implementation via Layer.succeed --------------- *
 * `Layer.succeed(Tag)(impl)` — curried.
 * Use this when the impl has no effects/dependencies to resolve.
 */

const GreeterLive = Layer.succeed(Greeter)({
  greet: (name) => Effect.succeed(`Hello, ${name}!`),
});

/* ---------- 3. Consume the service --------------------------------------- */

const program = Effect.gen(function* () {
  const greeter = yield* Greeter; // unwrap the service
  const msg = yield* greeter.greet("Ridho");
  return msg;
});

const msg = await Effect.runPromise(program.pipe(Effect.provide(GreeterLive)));
console.log("3) Greeter.greet:", msg);

/* ---------- 4. Layer.effect — service that depends on other services ----- *
 * Compose: a Logger that prefixes messages with a clock timestamp.
 */

interface ClockShape {
  readonly now: () => Effect.Effect<number>;
}
class Clock extends Context.Service<Clock, ClockShape>()("app/Clock") {}

const ClockLive = Layer.succeed(Clock)({
  now: () => Effect.sync(() => Date.now()),
});

interface LoggerShape {
  readonly info: (msg: string) => Effect.Effect<void>;
}
class Logger extends Context.Service<Logger, LoggerShape>()("app/Logger") {}

const LoggerLive = Layer.effect(Logger)(
  Effect.gen(function* () {
    const clock = yield* Clock; // Logger depends on Clock
    return {
      info: (msg) =>
        Effect.gen(function* () {
          const t = yield* clock.now();
          console.log(`[${t}] ${msg}`);
        }),
    };
  }),
);

/* ---------- 5. Wire the dependency graph --------------------------------- *
 * Two common primitives:
 *   - Layer.merge(A, B)     → Layer offering A & B (if A and B are peers)
 *   - Layer.provide(X, Y)   → Y's requirements satisfied by X
 *
 * Here: LoggerLive needs Clock → Layer.provide(ClockLive).
 */

const AppLive = LoggerLive.pipe(Layer.provide(ClockLive));

const app = Effect.gen(function* () {
  const log = yield* Logger;
  yield* log.info("Services are wired.");
});

await Effect.runPromise(app.pipe(Effect.provide(AppLive)));

/* ---------- 6. Multiple Layer variants (Production / Development / Mock) -- *
 * A common pattern from tbiz_ts: attach alternate Layers as static fields
 * on the service class. See `PersonService.Development/Production` in
 * `packages/api-client/src/example/context_tag.ts`.
 */

class Mailer extends Context.Service<Mailer, {
  readonly send: (to: string, body: string) => Effect.Effect<string>;
}>()("app/Mailer") {
  static Live = Layer.succeed(Mailer)({
    send: (to, body) =>
      Effect.succeed(`[PROD] emailed ${to} with ${body.length} bytes`),
  });

  static Mock = Layer.succeed(Mailer)({
    send: (to, body) =>
      Effect.succeed(`[MOCK] would have emailed ${to} / ${body}`),
  });
}

const sendSomething = Effect.gen(function* () {
  const m = yield* Mailer;
  return yield* m.send("you@example.com", "hello");
});

console.log("6a)", await Effect.runPromise(sendSomething.pipe(Effect.provide(Mailer.Live))));
console.log("6b)", await Effect.runPromise(sendSomething.pipe(Effect.provide(Mailer.Mock))));

/* ---------- Key takeaways ------------------------------------------------- *
 *   Context.Service<Self, Shape>()("id")   — the tag (was ServiceMap in beta.31)
 *   Layer.succeed(Tag)(impl)               — curried!
 *   Layer.effect(Tag)(Effect.gen(...))     — curried!
 *   yield* Tag                             — only inside Effect.gen
 *   Layer.merge, Layer.provide, Layer.mergeAll — compose layers
 */
