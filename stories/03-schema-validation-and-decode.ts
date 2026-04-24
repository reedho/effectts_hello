/**
 * 03 — Schema validation, filters, decoding.
 *
 * - `Schema.check(pred1, pred2, ...)` attaches runtime predicates.
 * - `Schema.isMinLength` / `isPattern` are the v4 filter builders
 *   (replacing v3's `Schema.minLength` / `Schema.pattern`).
 * - `Schema.decodeUnknown*` gives you different return envelopes:
 *      Sync   → throws on failure
 *      Exit   → Exit<A, SchemaError> (preferred in tests)
 *      Option → Option<A> (discards error info)
 *      Effect → Effect<A, SchemaError>
 *
 * v4 quirk: `withDecodingDefault` takes an **Effect** now, not a thunk
 * (that's changed from beta.31's `() => value` style — confirmed by the
 * type signature in this exact package version).
 *
 * Run: `bun stories/03-schema-validation-and-decode.ts`
 * Real-world: `tbiz_ts/packages/rpc-client/src/schemas/auth.ts`
 */

import { Cause, Effect, Exit, Option, Schema } from "effect";

/* ---------- 1. check + isMinLength + isPattern --------------------------- */

const Email = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1, { message: "Email is required" }),
    Schema.isPattern(/.+@.+\..+/, { message: "Invalid email format" }),
  ),
);

const Password = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(8, { message: "Password must be at least 8 characters" }),
  ),
);

const LoginCredentials = Schema.Struct({ email: Email, password: Password });

/* ---------- 2. decodeUnknownSync — easy, throws on failure ---------------- */

const ok = Schema.decodeUnknownSync(LoginCredentials)({
  email: "ridho@example.com",
  password: "password1",
});
console.log("1) sync ok:", ok);

try {
  Schema.decodeUnknownSync(LoginCredentials)({ email: "nope", password: "p" });
} catch (e) {
  console.log("2) sync threw:", (e as Error).message.split("\n")[0]);
}

/* ---------- 3. decodeUnknownExit — the testable path --------------------- *
 * In tbiz_ts tests (see packages/api-client/src/__tests__/insurance.test.ts)
 * the canonical pattern is:
 *     const result = Schema.decodeUnknownExit(Foo)(data);
 *     expect(Exit.isSuccess(result)).toBe(true);
 */

const good = Schema.decodeUnknownExit(LoginCredentials)({
  email: "ridho@example.com",
  password: "password1",
});
console.log("3a) exit isSuccess:", Exit.isSuccess(good));

const bad = Schema.decodeUnknownExit(LoginCredentials)({
  email: "not-an-email",
  password: "short",
});
console.log("3b) exit isFailure:", Exit.isFailure(bad));

/* ---------- 4. decodeUnknownOption — when you don't care why ------------- */

const maybe = Schema.decodeUnknownOption(LoginCredentials)({ email: "x", password: "y" });
console.log("4) option isNone (invalid):", Option.isNone(maybe));

/* ---------- 5. withDecodingDefault --------------------------------------- *
 * If a field is missing, fill it at decode time with a default value.
 * v4-beta.57 takes an `Effect<Encoded>` (not a thunk). For a constant,
 * `Effect.succeed(value)` does the job.
 *
 * TS caveat (noted in EFFECT_V4_MIGRATION.md §3): the output type may still
 * show the field as `T | undefined` — guard with `?? fallback` on reads.
 */

const UserPrefs = Schema.Struct({
  name: Schema.String,
  rating: Schema.optional(Schema.Number).pipe(
    Schema.withDecodingDefault(Effect.succeed(0)),
  ),
  tags: Schema.optional(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefault(Effect.succeed([] as readonly string[])),
  ),
});

const decoded = Schema.decodeUnknownSync(UserPrefs)({ name: "r" });
console.log("5) defaults applied:", decoded);

/* ---------- 6. Walking SchemaIssue on failure ---------------------------- *
 * Lifted from `tbiz_ts/packages/rpc-client/src/form/validators.ts`.
 * When you need per-field messages (e.g. for form UIs), recurse the
 * SchemaIssue tree and collect path → message pairs.
 *
 * v4 tag renames: Type→InvalidType, Missing→MissingKey,
 * Refinement→Filter, Transformation→Encoding.
 */

import type * as SchemaIssue from "effect/SchemaIssue";

function getIssueMessage(issue: SchemaIssue.Issue): string {
  switch (issue._tag) {
    case "Filter":
    case "Pointer":
    case "Encoding":
      return getIssueMessage(issue.issue);
    case "MissingKey":
      return "This field is required";
    case "Composite": {
      const first = issue.issues[0];
      return first ? getIssueMessage(first) : "Validation error";
    }
    default:
      return String(issue);
  }
}

function collectFieldErrors(
  issue: SchemaIssue.Issue,
  path: string[] = [],
): Record<string, string> {
  const errs: Record<string, string> = {};
  switch (issue._tag) {
    case "Pointer": {
      const next = [...path, ...issue.path.map(String)];
      Object.assign(errs, collectFieldErrors(issue.issue, next));
      break;
    }
    case "Composite":
      for (const sub of issue.issues) Object.assign(errs, collectFieldErrors(sub, path));
      break;
    case "Filter":
    case "Encoding":
      Object.assign(errs, collectFieldErrors(issue.issue, path));
      break;
    default: {
      const key = path.length ? path.join(".") : "_root";
      errs[key] ??= getIssueMessage(issue);
    }
  }
  return errs;
}

const failure = Schema.decodeUnknownExit(LoginCredentials)({
  email: "bad",
  password: "x",
});

Exit.match(failure, {
  onFailure: (cause) => {
    // onFailure receives a Cause<SchemaError>; extract the typed error first.
    const errOpt = Cause.findErrorOption(cause);
    if (Option.isSome(errOpt)) {
      const err = errOpt.value; // SchemaError
      console.log("6) per-field errors:", collectFieldErrors(err.issue));
    }
  },
  onSuccess: () => undefined,
});
