/**
 * 05 — Services and Layers (dependency injection).
 *
 * effect-solutions recommends:
 *   - `static readonly layer`   (production implementation)
 *   - `static readonly testLayer` (lightweight test implementation)
 *   - `Effect.fn("Name.method")(function* () { ... })` for service methods
 *     (gives call-site tracing and a span name for telemetry)
 *   - Sketch leaf service *tags* first; implement later ("service-driven
 *     development")
 *   - `Effect.provide` **once** at the edge — don't scatter it
 *
 * Version skew note: effect-solutions documents `ServiceMap.Service`; in
 * effect-beta.57 that module was renamed to `Context`. Same pattern,
 * different import. We use `Context.Service` throughout.
 *
 * Run: `bun stories/05-services-and-layers.ts`
 */

import { Context, Effect, Layer } from "effect";

/* ---------- 1. Sketch a leaf service tag — no impl yet ------------------- *
 * This is the core of "service-driven development": write the *contract*
 * first, across the whole graph. Higher-level code can be written and
 * type-checked immediately, without waiting for infra.
 */

interface GreeterShape {
  readonly greet: (name: string) => Effect.Effect<string>;
}

class Greeter extends Context.Service<Greeter, GreeterShape>()("app/Greeter") {}

/* ---------- 2. Production implementation — `static readonly layer` ------ */

class GreeterImpl {
  static readonly layer = Layer.effect(Greeter)(
    Effect.gen(function* () {
      // Service methods — use Effect.fn for call-site tracing + span name
      const greet = Effect.fn("Greeter.greet")(function* (name: string) {
        return `Hello, ${name}!`;
      });
      return { greet };
    }),
  );

  // Test implementation — deterministic, lightweight
  static readonly testLayer = Layer.succeed(Greeter)({
    greet: (name) => Effect.succeed(`[test] hi ${name}`),
  });
}

/* ---------- 3. Consume the service via yield* ---------------------------- *
 * Services are *not* Effect values — you can't pipe them. Consume with
 * `yield* Tag` inside an `Effect.gen`.
 */

const program = Effect.fn("program")(function* () {
  const greeter = yield* Greeter;
  return yield* greeter.greet("Ridho");
});

console.log(
  "3a) prod:",
  await Effect.runPromise(program().pipe(Effect.provide(GreeterImpl.layer))),
);
console.log(
  "3b) test:",
  await Effect.runPromise(program().pipe(Effect.provide(GreeterImpl.testLayer))),
);

/* ---------- 4. Layer.effect — implementation with dependencies ----------- *
 * The `Logger` needs `Clock`. Declare the dependency via `yield* Clock`
 * inside the implementation Effect; Effect tracks it in the Layer's R.
 */

interface ClockShape {
  readonly now: () => Effect.Effect<number>;
}
class Clock extends Context.Service<Clock, ClockShape>()("app/Clock") {
  static readonly layer = Layer.succeed(Clock)({
    now: () => Effect.sync(() => Date.now()),
  });

  static readonly testLayer = Layer.succeed(Clock)({
    now: () => Effect.succeed(0), // deterministic — time starts at 0
  });
}

interface LoggerShape {
  readonly info: (msg: string) => Effect.Effect<void>;
}
class Logger extends Context.Service<Logger, LoggerShape>()("app/Logger") {
  static readonly layer = Layer.effect(Logger)(
    Effect.gen(function* () {
      const clock = yield* Clock;
      const info = Effect.fn("Logger.info")(function* (msg: string) {
        const t = yield* clock.now();
        console.log(`[${t}] ${msg}`);
      });
      return { info };
    }),
  );
}

/* ---------- 5. Wire the graph, provide once at the edge ------------------ *
 * Compose the whole app Layer with Layer.provideMerge so dependencies of
 * each service are satisfied by a sibling layer. Then `Effect.provide`
 * ONCE at main() — not inside business logic.
 */

const AppLayer = Logger.layer.pipe(Layer.provideMerge(Clock.layer));

const app = Effect.fn("app")(function* () {
  const log = yield* Logger;
  yield* log.info("Services are wired.");
});

await Effect.runPromise(app().pipe(Effect.provide(AppLayer)));

/* ---------- 6. Layer memoization gotcha ---------------------------------- *
 * Effect memoizes layers by **reference identity**. If you call a
 * parameterized layer constructor twice inline, you get two instances —
 * two connection pools, two caches, two whatever.
 *
 * The fix: store parameterized layers in a const, reuse that reference.
 */

// Fake "postgres" layer constructor that takes params
const makePgLayer = (_opts: { url: string; poolSize: number }) =>
  Layer.succeed(Clock)({ now: () => Effect.succeed(Date.now()) }); // stub

// ❌ BAD — two separate instances, even with identical params
const badLayer = Layer.mergeAll(
  Logger.layer.pipe(Layer.provide(makePgLayer({ url: "u", poolSize: 10 }))),
  Logger.layer.pipe(Layer.provide(makePgLayer({ url: "u", poolSize: 10 }))),
);
void badLayer;

// ✅ GOOD — single reference reused
const pgLayer = makePgLayer({ url: "u", poolSize: 10 });
const goodLayer = Layer.mergeAll(
  Logger.layer.pipe(Layer.provide(pgLayer)),
  Logger.layer.pipe(Layer.provide(pgLayer)),
);
void goodLayer;

console.log("6) layer memoization — see comments");

/* ---------- 7. Service-driven development sketch ------------------------- *
 * Sketch leaf tags across the graph (no impls yet). Write orchestration
 * on top. The code type-checks immediately — infra comes later.
 */

interface UsersShape {
  readonly findById: (id: string) => Effect.Effect<{ id: string; email: string }>;
}
class Users extends Context.Service<Users, UsersShape>()("app/Users") {}

interface EmailsShape {
  readonly send: (to: string, body: string) => Effect.Effect<void>;
}
class Emails extends Context.Service<Emails, EmailsShape>()("app/Emails") {}

// Higher-level service, written *before* Users/Emails have implementations:
class Notifier extends Context.Service<Notifier, {
  readonly welcome: (userId: string) => Effect.Effect<void>;
}>()("app/Notifier") {
  static readonly layer = Layer.effect(Notifier)(
    Effect.gen(function* () {
      const users = yield* Users;
      const emails = yield* Emails;

      const welcome = Effect.fn("Notifier.welcome")(function* (userId: string) {
        const u = yield* users.findById(userId);
        yield* emails.send(u.email, `Welcome, ${u.id}!`);
      });

      return { welcome };
    }),
  );
}

// Add impls later — Notifier never changes.
void Notifier;

/* ---------- Key takeaways ------------------------------------------------- *
 *   Context.Service<Self, Shape>()("id")  — tag
 *   static readonly layer / testLayer     — canonical layer names
 *   Effect.fn("Svc.method")(function*()   — traced, named methods
 *   Layer.succeed / Layer.effect          — curried in v4
 *   Layer.provide / Layer.provideMerge    — wire the graph
 *   Effect.provide ONCE at the edge
 *   Parameterized layers: store once, reuse the const
 *   Sketch leaf tags first; implementations come later
 */
