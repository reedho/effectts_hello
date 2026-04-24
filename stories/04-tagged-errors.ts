/**
 * 04 — Tagged errors + defects.
 *
 * effect-solutions recommends **Schema.TaggedErrorClass** over
 * `Data.TaggedError` for domain errors, because Schema-based errors are:
 *   - serializable (send over network, save to DB)
 *   - **yieldable directly** — `yield* new X(...)` (no `Effect.fail` wrap)
 *   - pattern-matchable via `_tag`
 *   - extensible via class methods
 *
 * This chapter also separates **typed errors** (recoverable) from
 * **defects** (unrecoverable — terminate the fiber, handle at the edge).
 *
 * Run: `bun stories/04-tagged-errors.ts`
 */

import { Data, Effect, Schema, pipe } from "effect";

/* ---------- 1. Schema.TaggedErrorClass — the recommended form ------------ */

class ApiError extends Schema.TaggedErrorClass<ApiError>()("ApiError", {
  code: Schema.String,
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  code: Schema.Literals(["TOKEN_EXPIRED", "TOKEN_INVALID", "UNAUTHORIZED"]),
}) {}

class NetworkError extends Schema.TaggedErrorClass<NetworkError>()("NetworkError", {
  message: Schema.String,
  // Schema.Defect safely wraps unknown errors from external libraries
  // (fetch, axios, Firebase, ...). Turns them into serializable values.
  cause: Schema.Defect,
}) {}

type AppError = ApiError | AuthError | NetworkError;

/* ---------- 2. Fail with a typed error — yield it directly --------------- *
 * TaggedError values are already yieldable Effects. No `Effect.fail` wrap.
 */

const fetchUser = (id: string): Effect.Effect<{ id: string; name: string }, AppError> =>
  Effect.gen(function* () {
    // `return yield*` on an error preserves the "this branch never succeeds"
    // signal for the generator — the language-service requires it for clean
    // narrowing / tooling.
    if (id === "") {
      return yield* new ApiError({ code: "EBAD", message: "id is required", status: 400 });
    }
    if (id === "401") {
      return yield* new AuthError({ code: "UNAUTHORIZED", message: "token missing" });
    }
    if (id === "net") {
      return yield* new NetworkError({
        message: "connect ECONNREFUSED",
        cause: new Error("ECONNREFUSED 127.0.0.1:5432"),
      });
    }
    return { id, name: "Ridho" };
  });

/* ---------- 3. Recover with Effect.catchTag ------------------------------ */

const withRefresh = (id: string) =>
  pipe(
    fetchUser(id),
    Effect.catchTag("AuthError", (e) =>
      Effect.succeed({ id: "guest", name: `fallback (was ${e.code})` }),
    ),
  );

console.log("3a) happy:", await Effect.runPromise(withRefresh("42")));
console.log("3b) 401 caught:", await Effect.runPromise(withRefresh("401")));

/* ---------- 4. Effect.catchTags — handle many at once -------------------- */

const handled = (id: string) =>
  pipe(
    fetchUser(id),
    Effect.catchTags({
      ApiError: (e) => Effect.succeed(`API ${e.code}: ${e.message}`),
      AuthError: () => Effect.succeed("please log in"),
      NetworkError: (e) => Effect.succeed(`retry later: ${e.message}`),
    }),
  );

console.log("4a):", await Effect.runPromise(handled("")));
console.log("4b):", await Effect.runPromise(handled("401")));
console.log("4c):", await Effect.runPromise(handled("net")));

/* ---------- 5. Schema.Defect — wrapping third-party errors --------------- *
 * When you call fetch/axios/firebase, the "error" could be literally
 * anything. `Schema.Defect` stores it losslessly and serializably.
 */

const fetchSomething = (url: string) =>
  Effect.tryPromise({
    try: () => fetch(url).then((r) => r.json() as Promise<unknown>),
    catch: (error) =>
      new NetworkError({ message: `fetch ${url} failed`, cause: error }),
  });
void fetchSomething;

/* ---------- 6. Typed errors vs. Defects ---------------------------------- *
 * Typed errors are things the caller can reasonably handle (404, auth,
 * validation). Defects are things the caller *can't* handle — bugs,
 * invariant violations, "the app should stop".
 *
 * `Effect.orDie` converts a typed error into a defect. Use it at places
 * where recovery is meaningless (config load at startup, invariants that
 * must hold for the program to continue).
 */

const loadConfig = Effect.fail(new ApiError({ code: "EENV", message: "no config" }));

// At the top of main(): if loadConfig fails, nothing can proceed. Die.
const main = Effect.gen(function* () {
  const cfg = yield* loadConfig.pipe(Effect.orDie);
  return cfg;
});

// We won't actually run this — it would halt the program. But the shape
// is: defects propagate until caught at a boundary (logger, crash reporter).
void main;

/* ---------- 7. Catching defects only at the edge ------------------------- *
 * `Effect.catchDefect` lets you intercept defects for diagnostics or
 * plugin sandboxing. Use *very* sparingly — defects indicate the program
 * is already in a bad state.
 */

const boom = Effect.sync(() => {
  throw new RangeError("oops");
});

const logged = pipe(
  boom,
  Effect.catchDefect((defect) =>
    Effect.sync(() => {
      console.log("7) caught defect:", (defect as Error).message);
      return "recovered-for-logging";
    }),
  ),
);

console.log("7 result:", await Effect.runPromise(logged));

/* ---------- Legacy: Data.TaggedError ------------------------------------- *
 * The older `Data.TaggedError("Tag")<Payload>` is still supported (and
 * still appears all over tbiz_ts — see packages/api-client/src/error.ts).
 * It's structurally similar but NOT Schema-integrated: not serializable,
 * not validated. Prefer `Schema.TaggedErrorClass` in new code.
 */
class LegacyError extends Data.TaggedError("LegacyError")<{
  readonly message: string;
}> {}
void LegacyError;

/* ---------- Takeaways ----------------------------------------------------- *
 *   Schema.TaggedErrorClass — preferred; yieldable + Schema-integrated
 *   yield* new Err(...)     — no Effect.fail wrapper needed
 *   Schema.Defect           — for wrapping unknown third-party errors
 *   Effect.catchTag/Tags    — narrow on _tag
 *   Effect.orDie            — convert typed error → defect at boundaries
 *   Effect.catchDefect      — only at the outer edge (logger, crash report)
 */
