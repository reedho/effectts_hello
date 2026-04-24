/**
 * 11 — Testing Effect code with bun:test.
 *
 * **Tooling note.** effect-solutions recommends `@effect/vitest` for Effect
 * tests — it gives you `it.effect`, `TestClock`, `TestRandom`, auto-scope
 * cleanup, and `it.layer` for suite-shared layers. None of that is
 * available in `bun:test`. This project uses `bun:test` because the
 * CLAUDE.md mandate says to — the patterns below are the closest
 * equivalents. When your tests need test time or scoped resources, add
 * `@effect/vitest` as a project exception.
 *
 * The canonical test shape is unchanged either way: decode with
 * `decodeUnknownExit`, assert with `Exit.isSuccess/isFailure`.
 *
 * Run: `bun test stories/11-testing.test.ts`
 */

import { expect, test, describe } from "bun:test";
import { Cause, Context, Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect";

/* ========================================================================= */
/* Schema tests                                                              */
/* ========================================================================= */

const Country = Schema.Struct({
  alpha2Code: Schema.String.pipe(Schema.check(Schema.isMinLength(2))),
  countrySid: Schema.String,
});

describe("Country schema", () => {
  test("accepts well-formed payload", () => {
    const exit = Schema.decodeUnknownExit(Country)({
      alpha2Code: "ID",
      countrySid: "1001",
    });
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  test("rejects missing field", () => {
    const exit = Schema.decodeUnknownExit(Country)({ countrySid: "1001" });
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("rejects too-short alpha2 code", () => {
    const exit = Schema.decodeUnknownExit(Country)({
      alpha2Code: "X",
      countrySid: "1001",
    });
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("extracts typed data on success", () => {
    const exit = Schema.decodeUnknownExit(Country)({
      alpha2Code: "ID",
      countrySid: "1001",
    });
    if (Exit.isSuccess(exit)) {
      expect(exit.value.alpha2Code).toBe("ID");
    } else {
      throw new Error("expected success");
    }
  });
});

/* ========================================================================= */
/* Effect tests — running an Effect program against a testLayer              */
/* ========================================================================= */

class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", {
  id: Schema.String,
}) {}

interface UsersShape {
  readonly get: (id: string) => Effect.Effect<{ id: string; name: string }, NotFound>;
}
class Users extends Context.Service<Users, UsersShape>()("test/Users") {
  // Helper for building a test-specific layer — effect-solutions convention.
  static readonly makeTestLayer = (db: Record<string, string>) =>
    Layer.succeed(Users)({
      get: (id) =>
        db[id]
          ? Effect.succeed({ id, name: db[id] as string })
          : Effect.fail(new NotFound({ id })),
    });
}

describe("Users service", () => {
  test("returns a user when it exists", async () => {
    const runtime = ManagedRuntime.make(Users.makeTestLayer({ "1": "Ridho" }));

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const users = yield* Users;
        return yield* users.get("1");
      }),
    );

    expect(result).toEqual({ id: "1", name: "Ridho" });
    await runtime.dispose();
  });

  test("fails with a typed NotFound", async () => {
    const runtime = ManagedRuntime.make(Users.makeTestLayer({}));

    const exit = await runtime.runPromiseExit(
      Effect.gen(function* () {
        const users = yield* Users;
        return yield* users.get("missing");
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = Cause.findErrorOption(exit.cause);
      expect(Option.isSome(err)).toBe(true);
      if (Option.isSome(err)) {
        expect(err.value._tag).toBe("NotFound");
        expect(err.value.id).toBe("missing");
      }
    }

    await runtime.dispose();
  });
});

/* ========================================================================= */
/* Why `decodeUnknownExit` and not `decodeUnknownSync`?                      */
/* ========================================================================= */
/*
 *  - `Sync` throws a SchemaError. Wrapping every test in try/catch is noisy.
 *  - `Exit` is a plain value: assert with `Exit.isSuccess` / `Exit.isFailure`.
 *  - For error-shape assertions, narrow with `if (Exit.isFailure(exit))`
 *    and pull the typed error via `Cause.findErrorOption(exit.cause)`.
 *
 * This is exactly the pattern used in
 * `packages/api-client/src/__tests__/insurance.test.ts` and similar.
 */
