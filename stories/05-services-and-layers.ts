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

/* ---------- 8. Request-scoped services (auth, tenant, requestId) -------- *
 * Long-lived services (Db, HttpClient) live in the app-wide layer. But
 * some context is *per-request*: the authenticated user, the tenant, a
 * request ID for tracing. Model these as a service too — and build a
 * fresh layer at the top of each request.
 *
 * Business code reads them via `yield* Tenant` like any other service;
 * the parameter never has to be threaded through call sites.
 */

interface TenantShape {
  readonly id: string;
  readonly plan: "free" | "pro";
}
class Tenant extends Context.Service<Tenant, TenantShape>()("app/Tenant") {
  // Per-request constructor — call with the request's context.
  static readonly forRequest = (ctx: TenantShape) => Layer.succeed(Tenant)(ctx);
}

const quota = Effect.fn("quota")(function* () {
  const t = yield* Tenant;
  return t.plan === "pro" ? "unlimited" : "100/day";
});

// A request handler builds the per-request layer once and provides it.
const handleRequest = (req: TenantShape) =>
  quota().pipe(Effect.provide(Tenant.forRequest(req)));

console.log(
  "8a) free tenant quota:",
  await Effect.runPromise(handleRequest({ id: "t-1", plan: "free" })),
);
console.log(
  "8b) pro tenant quota:",
  await Effect.runPromise(handleRequest({ id: "t-2", plan: "pro" })),
);

/* ---------- 9. Service swap inside a scope (DB transaction) ------------- *
 * The `Db` service runs queries against a connection pool. Inside a
 * transaction, every query in the body must use the *same* dedicated
 * connection — but the business code shouldn't have to change.
 *
 * The trick: `Effect.provideService(Db, txHandle)` rebinds the `Db` tag
 * locally for the duration of `body`. Any `yield* Db` inside the body
 * sees the transaction-scoped handle. Outside the body, the pool-backed
 * `Db` is unchanged.
 */

interface DbShape {
  readonly query: (sql: string) => Effect.Effect<string>;
}
class Db extends Context.Service<Db, DbShape>()("app/Db") {
  static readonly layer = Layer.succeed(Db)({
    query: (sql) => Effect.succeed(`pool: ${sql}`),
  });
}

// Real code would BEGIN/COMMIT around the body and ROLLBACK on failure.
const beginTx = Effect.sync<DbShape>(() => ({
  query: (sql: string) => Effect.succeed(`tx#42: ${sql}`),
}));

const inTransaction = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const tx = yield* beginTx;
    return yield* body.pipe(Effect.provideService(Db, tx));
  });

const insertTwo = Effect.gen(function* () {
  const db = yield* Db;
  const a = yield* db.query("INSERT a");
  const b = yield* db.query("INSERT b");
  return [a, b];
});

const insertOne = Effect.gen(function* () {
  const db = yield* Db;
  return yield* db.query("INSERT outside-tx");
});

const program9 = Effect.gen(function* () {
  const outside = yield* insertOne; // pool-backed
  const inside = yield* inTransaction(insertTwo); // tx-backed
  return { outside, inside };
});

console.log("9) tx swap:", await Effect.runPromise(program9.pipe(Effect.provide(Db.layer))));

/* ---------- 10. Effect.acquireDisposable — TC39 explicit resource mgmt --- *
 * (beta.63) Many native bindings now implement `[Symbol.dispose]` /
 * `[Symbol.asyncDispose]` so the JS runtime can clean them up at scope
 * exit (think `using db = new sqlite.DatabaseSync(...)`).
 *
 * `Effect.acquireDisposable` wraps an Effect that produces such an object
 * and turns it into a scope-bound resource — no explicit release function
 * needed; the disposable's own method handles cleanup. Compare with
 * `Effect.acquireRelease(acquire, release)` where you wire the release
 * step yourself.
 */

class Connection implements Disposable {
  constructor(readonly label: string) {
    console.log(`   acquire ${label}`);
  }
  query(sql: string) {
    return `${this.label}> ${sql}`;
  }
  [Symbol.dispose]() {
    console.log(`   dispose ${this.label}`);
  }
}

const useConn = Effect.gen(function* () {
  const conn = yield* Effect.acquireDisposable(
    Effect.sync(() => new Connection("conn-1")),
  );
  // Use it freely within the scope; [Symbol.dispose] runs at scope close.
  return conn.query("SELECT 1");
});

console.log(
  "10) acquireDisposable:",
  await Effect.runPromise(Effect.scoped(useConn)),
);
// stdout order: acquire → dispose (scope closes inside runPromise) → "10) …"

/* ---------- Key takeaways ------------------------------------------------- *
 *   Context.Service<Self, Shape>()("id")  — tag
 *   static readonly layer / testLayer     — canonical layer names
 *   Effect.fn("Svc.method")(function*()   — traced, named methods
 *   Layer.succeed / Layer.effect          — curried in v4
 *   Layer.provide / Layer.provideMerge    — wire the graph
 *   Effect.provide ONCE at the edge
 *   Parameterized layers: store once, reuse the const
 *   Sketch leaf tags first; implementations come later
 *   Per-request services: `static readonly forRequest = (ctx) => Layer.succeed(...)`
 *   Service swap inside a scope: `Effect.provideService(Tag, alt)` for
 *     transaction handles, fake clocks, request-scoped overrides
 *   Disposable resources: `Effect.acquireDisposable(eff)` reuses
 *     `[Symbol.dispose]`/`[Symbol.asyncDispose]` instead of writing a
 *     manual release fn (b63)
 */
