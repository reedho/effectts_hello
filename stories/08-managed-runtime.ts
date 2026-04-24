/**
 * 08 — ManagedRuntime: running Effects at the edge of a non-Effect world.
 *
 * A **ManagedRuntime** is a pre-built, disposable runtime over a Layer.
 * It's what you reach for in React, CLIs, servers — anywhere you need to
 * run Effects as Promises from plain-JS land without re-providing Layers
 * every time.
 *
 * Real-world: `apps/b2c-studio/src/services/qilin.ts`.
 *
 * Run: `bun stories/08-managed-runtime.ts`
 */

import { Cause, Context, Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect";

/* ---------- 1. Define a service + a domain error ------------------------- */

class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", {
  id: Schema.String,
}) {}

interface UsersShape {
  readonly get: (id: string) => Effect.Effect<{ id: string; name: string }, NotFound>;
}
class Users extends Context.Service<Users, UsersShape>()("app/Users") {
  static readonly layer = Layer.succeed(Users)({
    get: (id) =>
      id === "1"
        ? Effect.succeed({ id, name: "Ridho" })
        : Effect.fail(new NotFound({ id })),
  });
}

/* ---------- 2. Build the runtime once, reuse everywhere ------------------ */

const runtime = ManagedRuntime.make(Users.layer);

/* ---------- 3. runPromise — unwrap happy-path as a Promise --------------- */

const user = await runtime.runPromise(
  Effect.gen(function* () {
    const users = yield* Users;
    return yield* users.get("1");
  }),
);
console.log("3) runPromise:", user);

/* ---------- 4. runPromiseExit — get the Exit, inspect failures ----------- *
 * Preferred when the callsite has to handle both paths (e.g. React Query
 * error states, Express route handlers).
 */

const exit = await runtime.runPromiseExit(
  Effect.gen(function* () {
    const users = yield* Users;
    return yield* users.get("missing");
  }),
);

Exit.match(exit, {
  onSuccess: (u) => console.log("4a) ok:", u),
  onFailure: (cause) => {
    // Extract the typed error from the Cause
    const err = Cause.findErrorOption(cause);
    if (Option.isSome(err)) {
      // err.value is NotFound
      console.log("4b) failed:", err.value._tag, err.value.id);
    }

    // Defects (unexpected throws) come through as dies:
    const defect = Cause.findDefect(cause);
    if (defect._tag === "Success") {
      console.log("4c) defect:", defect.success);
    }

    // Interruption:
    if (Cause.hasInterrupts(cause)) {
      console.log("4d) was interrupted");
    }
  },
});

/* ---------- 5. Dispose the runtime --------------------------------------- *
 * Runtimes hold scope-managed resources. Always dispose when you're done
 * (React effect cleanups, server shutdown hooks, etc.).
 *
 * ⚠️ v4 gotcha: `ManagedRuntime` *is* the runtime — don't call
 * `runtime.runtime()` (v3 API, removed in v4).
 */

await runtime.dispose();
console.log("5) runtime disposed");

/* ---------- Cheat sheet -------------------------------------------------- *
 *   ManagedRuntime.make(layer)           — build once
 *   runtime.runPromise(effect)           — Promise<A>
 *   runtime.runPromiseExit(effect)       — Promise<Exit<A, E>>
 *   runtime.runSync(effect)              — synchronous variant
 *   runtime.dispose()                    — release resources
 *
 * v3 → v4:
 *   Runtime.runPromiseExit(rt)(effect)  → rt.runPromiseExit(effect)
 *   mr.runtime().then(setRuntime)       → setRuntime(mr)
 *   Cause.failureOption                 → Cause.findErrorOption
 *   Cause.isInterrupted                 → Cause.hasInterrupts
 *   Cause.dieOption (Option)            → Cause.findDefect (Result)
 */
