/**
 * 04 — Tagged errors + Effect.catchTag.
 *
 * `Data.TaggedError(tag)` gives you a typed error class with:
 *   - a literal `_tag` discriminator
 *   - structural equality
 *   - stack traces
 *
 * This is the canonical error-modeling pattern in tbiz_ts. See:
 *   - `packages/api-client/src/error.ts`         (ApiError, AuthError, NetworkError)
 *   - `packages/rpc-client/src/errors.ts`        (RpcError, NetworkError, ParseError, AuthError)
 *
 * Run: `bun stories/04-tagged-errors.ts`
 */

import { Data, Effect, pipe } from "effect";

/* ---------- 1. Define a family of errors with a shared domain ------------ */

class ApiError extends Data.TaggedError("ApiError")<{
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
  readonly code: "TOKEN_EXPIRED" | "TOKEN_INVALID" | "UNAUTHORIZED";
}> {}

class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

type AppError = ApiError | AuthError | NetworkError;

/* ---------- 2. Fail with a typed error ------------------------------------ */

const maybeFetchUser = (id: string): Effect.Effect<{ id: string; name: string }, AppError> =>
  Effect.gen(function* () {
    if (id === "") {
      return yield* Effect.fail(
        new ApiError({ code: "EBAD", message: "id is required", status: 400 }),
      );
    }
    if (id === "401") {
      return yield* Effect.fail(
        new AuthError({ code: "UNAUTHORIZED", message: "token missing" }),
      );
    }
    if (id === "net") {
      return yield* Effect.fail(
        new NetworkError({ message: "connect ECONNREFUSED", cause: null }),
      );
    }
    return { id, name: "Ridho" };
  });

/* ---------- 3. Effect.catchTag — handle one error by its _tag ------------- */

const withRefresh = (id: string) =>
  pipe(
    maybeFetchUser(id),
    Effect.catchTag("AuthError", (e) =>
      Effect.succeed({ id: "guest", name: `fallback (was ${e.code})` }),
    ),
  );

console.log("3a) happy:", await Effect.runPromise(withRefresh("42")));
console.log("3b) 401 caught:", await Effect.runPromise(withRefresh("401")));

/* ---------- 4. Effect.catchTags — handle many at once -------------------- */

const handled = (id: string) =>
  pipe(
    maybeFetchUser(id),
    Effect.catchTags({
      ApiError: (e) => Effect.succeed(`API ${e.code}: ${e.message}`),
      AuthError: () => Effect.succeed("please log in"),
      NetworkError: (e) => Effect.succeed(`retry later: ${e.message}`),
    }),
  );

console.log("4a):", await Effect.runPromise(handled("")));
console.log("4b):", await Effect.runPromise(handled("401")));
console.log("4c):", await Effect.runPromise(handled("net")));

/* ---------- 5. mapError — narrow or widen an error channel --------------- *
 * Useful at service boundaries: map a third-party error type into your
 * domain. In qilin/common.ts this pattern turns HttpBodyError/ConfigError
 * into ApiError.
 */

const liftErrors = (id: string) =>
  pipe(
    maybeFetchUser(id),
    Effect.mapError((e): ApiError => {
      if (e._tag === "ApiError") return e;
      return new ApiError({ code: "E_WRAP", message: e.message, cause: e });
    }),
  );

const lifted = await Effect.runPromise(
  pipe(
    liftErrors("401"),
    Effect.match({
      onFailure: (e) => `wrapped: ${e.code} / ${e.message}`,
      onSuccess: (u) => `ok: ${u.id}`,
    }),
  ),
);
console.log("5)", lifted);

/* ---------- Why `_tag`? -------------------------------------------------- *
 * Because `catchTag("AuthError", ...)` is purely a type-level narrowing on
 * the `_tag` discriminator. No `instanceof`, no structural checks, no
 * runtime reflection — just a literal string match. This makes error
 * handling trivially exhaustive with TypeScript's help.
 */
