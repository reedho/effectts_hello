# Alignment changelog

> Companion to [`AUDIT.md`](./AUDIT.md). The audit identifies gaps; this document explains every change that closed them — what swapped for what, why effect-solutions recommends it, the trade-offs, and when the older form is still fine.
>
> Scope: the alignment pass on **2026-04-24**. Commits `9661872..53640bc`.

## TL;DR

| # | Change                                                | Where                             | Why                                               |
| - | ----------------------------------------------------- | --------------------------------- | ------------------------------------------------- |
| 1 | `Effect.gen((id) => ...)` → `Effect.fn("name")(...)`  | Stories 01, 05, 10                | Spans, call-site traces, cleaner signatures        |
| 2 | `Schema.Struct` → `Schema.Class`                      | Story 02 records                  | Methods on domain types; richer class semantics    |
| 3 | Ad-hoc unions → `Schema.TaggedClass` + `Match.valueTags` | Story 02 variants              | Exhaustive pattern matching                        |
| 4 | Brand only IDs → brand **every** domain primitive     | Story 02                          | Prevent mixing Email with string, Port with number |
| 5 | Manual `JSON.parse` + decode → `Schema.fromJsonString`| Story 02                          | One-step codec; errors flow through `E`            |
| 6 | `Data.TaggedError` → `Schema.TaggedErrorClass`        | Stories 04, 08, 09, 11            | Serializable + Schema-integrated                   |
| 7 | `yield* Effect.fail(new E())` → `return yield* new E()`| Stories 04, 09                   | Yieldable errors — removes a wrapper + preserves narrowing |
| 8 | No defect story → defects chapter                     | Story 04                          | Separate recoverable from unrecoverable failures    |
| 9 | `static Live` / `static Mock` → `static readonly layer` / `testLayer` | Stories 05, 06, 08   | effect-solutions naming; matches ecosystem docs    |
| 10 | Plain method lambdas → `Effect.fn("Svc.method")(...)` | Story 05                         | Per-method spans + traces                          |
| 11 | Nothing → "service-driven development" section        | Story 05                          | Teach sketching the graph before implementing      |
| 12 | Nothing → "layer memoization" gotcha                  | Story 05                          | Avoid duplicate pools/caches in real deployments   |
| 13 | `Config.mapOrFail` / ad-hoc validation → `Config.schema(Brand, "ENV")` | Story 06            | Reuse one Schema across config + boundaries + forms |
| 14 | Nothing → "skip ConfigProvider in tests" guidance     | Story 06                          | Simpler tests — provide the config service's `testLayer` directly |
| 15 | Test layers inline → `Users.makeTestLayer(seed)` factory | Story 11                       | effect-solutions test convention                   |

Each of these is discussed below with the reasoning behind it.

## 1. `Effect.fn` for effectful function declarations

**Before**
```ts
const loadUser = (id: string) =>
  Effect.gen(function* () {
    yield* Effect.sleep("10 millis")
    return { id, name: "Ridho" }
  })
```

**After**
```ts
const loadUser = Effect.fn("loadUser")(function* (id: string) {
  yield* Effect.sleep("10 millis")
  return { id, name: "Ridho" }
})
```

**Why.** Three real wins:
- The string becomes a telemetry span name. Anywhere OpenTelemetry is wired up, `loadUser` shows up in traces without extra code.
- The stack trace preserved with the fn knows where `loadUser` was *invoked*, not just where it was declared — useful when a generic helper fails.
- The signature reads better. One wrapper, one function.

**Pros**
- Free spans and call-site traces.
- Encourages naming every meaningful effectful function (observability follows).

**Cons**
- Slight runtime cost vs a raw closure (negligible in practice).
- `Effect.fn`'s return type includes span machinery — occasionally annoys TS inference in very generic helpers.
- Unfamiliar shape for readers new to Effect.

**Keep the old form when.** Very short anonymous blocks or closures inside a larger `Effect.gen`. Not every expression needs a span.

## 2. `Schema.Struct` → `Schema.Class` for records

**Before**
```ts
const User = Schema.Struct({
  id: UserId, name: Schema.String, email: Email,
})
type User = Schema.Schema.Type<typeof User>
```

**After**
```ts
class User extends Schema.Class<User>("User")({
  id: UserId, name: Schema.String, email: Email,
}) {
  get displayName() { return `${this.name} <${this.email}>` }
}
```

**Why.** effect-solutions: "use `Schema.Class` for composite data models with multiple fields." The class shape lets you attach methods / getters directly on the type, so domain behaviour lives next to the data.

**Pros**
- Methods and computed properties live on the type.
- `new User({...})` reads nicely at call sites.
- Enables `Animal.extend<Dog>("Dog")({...})` for real inheritance.
- Pretty-prints identifier in logs (`"User({ name: Alice, age: 30 })"`).

**Cons**
- Classes are heavier than anonymous structs — if you just need a `{ x, y }` shape, it's overkill.
- Schema.Class throws a `SchemaError` on bad input *at construction time* if you `new` it with invalid data. Some code wants decoding to be explicit.

**Keep the old form when.** Fully anonymous shapes (config records, ad-hoc DTOs without behaviour).

## 3. Tagged variants: `Schema.TaggedClass` + `Match.valueTags`

**Before.** We didn't have a proper variants story; users would roll their own `Schema.Union` + `switch`.

**After**
```ts
class PaymentSucceeded extends Schema.TaggedClass<PaymentSucceeded>("PaymentSucceeded")(
  "PaymentSucceeded", { txId: Schema.String, amount: Schema.Number },
) {}
class PaymentFailed extends Schema.TaggedClass<PaymentFailed>("PaymentFailed")(
  "PaymentFailed", { reason: Schema.String, retryable: Schema.Boolean },
) {}

const PaymentResult = Schema.Union([PaymentSucceeded, PaymentFailed])

const describe = (r: PaymentResult) =>
  Match.valueTags(r, {
    PaymentSucceeded: ({ txId, amount }) => `OK ${txId} ($${amount})`,
    PaymentFailed:    ({ reason })        => `fail: ${reason}`,
  })
```

**Why.** `Schema.TaggedClass` auto-adds `_tag`. `Match.valueTags` uses that `_tag` to enforce exhaustiveness: add a new variant, the compiler tells you every matcher that needs an update.

**Pros**
- Exhaustive matching at compile time.
- Each variant is a real class — construct with `new`, pass around, test.
- Pairs naturally with `Schema.Union` for serialization boundaries.

**Cons**
- More ceremony than a raw union of structs for tiny sum types.
- `Match.valueTags` is one of several patterns (`Match.value`, `Match.type`, bare `switch`) — newcomers have to pick.

**Keep the old form when.** Sum types with no payload differences; flat `Schema.Literals([...])` is still the right call.

## 4. Brand every domain primitive

**Before.** Only IDs were branded.

**After.** `Email`, `Port`, `UserId`, `PostId` — all branded. effect-solutions: "In a well-designed domain model, nearly all primitives should be branded."

**Pros**
- `sendEmail(userId)` won't compile — free defense against parameter-swap bugs.
- Brand annotations survive through the schema, so decoded values are already branded.
- Same schema reusable for config, HTTP boundary, form validation.

**Cons**
- More construction noise: `Schema.decodeUnknownSync(Email)("a@b.c")` rather than a string literal.
- In beta.57, branded schemas don't expose `.makeUnsafe` yet — you decode. Later betas add a cheap constructor.
- Readers see many branded types and wonder "did I need all of these?" — yes, in a real app; no, in a throwaway.

**Keep the old form when.** Prototypes and internal helpers where values never cross module boundaries.

## 5. `Schema.fromJsonString` for JSON codecs

**Before**
```ts
const data = Schema.decodeUnknownSync(User)(JSON.parse(input))
```

**After**
```ts
const UserFromJson = Schema.fromJsonString(User)
const data = await Effect.runPromise(Schema.decodeUnknownEffect(UserFromJson)(input))
```

**Why.** One codec handles parse + decode. JSON parse failures flow through the Effect error channel instead of throwing separately.

**Pros**
- One step, not two. No try/catch around `JSON.parse`.
- Encode side: `encodeEffect(UserFromJson)(user)` stringifies + encodes.
- Same codec works in any direction.

**Cons**
- Slightly opaque — readers unfamiliar with schema composition don't see the parse happen.
- Slight overhead over raw `JSON.parse` when you know the input is trusted.

**Keep the old form when.** Inputs are already known to be valid JS values (e.g. Bun's `req.json()` returns a parsed value).

## 6. `Data.TaggedError` → `Schema.TaggedErrorClass`

**Before**
```ts
class ApiError extends Data.TaggedError("ApiError")<{
  readonly code: string; readonly message: string
}> {}
```

**After**
```ts
class ApiError extends Schema.TaggedErrorClass<ApiError>()("ApiError", {
  code: Schema.String,
  message: Schema.String,
}) {}
```

**Why.** `Data.TaggedError` gives you a typed class with `_tag`, equality, and stack traces — but it's *not* Schema. You can't decode it, encode it to JSON, or send it over the wire without writing extra plumbing. `Schema.TaggedErrorClass` is all of that plus Schema integration.

**Pros**
- Serializable and decodable — ship errors across processes, persist them, reconstruct from DB.
- Payload fields get real Schema validation at construction.
- Yieldable without `Effect.fail` (see §7).

**Cons**
- More imports / boilerplate than `Data.TaggedError`.
- Validation at construction means `new ApiError({ code: 123 })` (wrong type) throws synchronously — may surprise readers who expected a type error only.

**Keep the old form when.** Truly local, never-serialized errors inside a tight module — or reading legacy tbiz_ts code.

## 7. `yield* Effect.fail(new X(...))` → `return yield* new X(...)`

**Before**
```ts
if (!id) return yield* Effect.fail(new ApiError({ code: "EBAD", ... }))
```

**After**
```ts
if (!id) return yield* new ApiError({ code: "EBAD", ... })
```

**Why.** `Schema.TaggedErrorClass` values are *already yieldable Effects*. Wrapping in `Effect.fail` is redundant — the language-service literally emits a diagnostic (`unnecessaryFailYieldableError`) for the old form.

The `return` in front is important: the Effect language-service's `missingReturnYieldStar` check prevents silently reachable code after a failing `yield*`. With `return`, the generator signals "this branch can't proceed", which lets TypeScript narrow subsequent code correctly.

**Pros**
- Shorter, less noise.
- Removes the only point in the pipeline that didn't type-check as tightly as it could.
- Readers stop wondering "why are some errors wrapped and others aren't".

**Cons**
- Relies on the `Schema.TaggedErrorClass` (or `Data.TaggedError`) base class — doesn't work for raw values.
- `return yield*` looks funky until you've seen it a few times.

**Keep the old form when.** Failing with a non-tagged, non-class value (rare — consider making it a tagged class).

## 8. Typed errors vs. defects

Effectful programs have two distinct failure modes:

- **Typed errors** (recoverable) — 404s, auth, validation. Live in `E` channel. Caller can `catchTag` them.
- **Defects** (unrecoverable) — bugs, invariants, "config missing at startup". Terminate the fiber. Handled once at the edge.

We now cover `Effect.orDie` (typed error → defect) and `Effect.catchDefect` (edge-only diagnostics), plus `Schema.Defect` for safely wrapping foreign error values inside tagged errors.

**Pros**
- Makes the intent obvious at the call site.
- `Effect.orDie` at `main()` forces "this failure means the program should halt" to be explicit.
- Surfaces the cost of over-tracking errors: if you'd never recover, stop putting it in `E`.

**Cons**
- One more concept. Newcomers want "error" to mean one thing.
- `Effect.catchDefect` is easy to misuse — a single over-eager `catchDefect` can hide real bugs.

**Keep the old form when.** There is no "old form" here — this was net new material.

## 9. Layer naming: `Live` / `Mock` → `layer` / `testLayer`

**Before**
```ts
class Mailer extends Context.Service<Mailer, ...>()("app/Mailer") {
  static Live = Layer.succeed(...)
  static Mock = Layer.succeed(...)
}
```

**After**
```ts
class Mailer extends Context.Service<Mailer, ...>()("app/Mailer") {
  static readonly layer     = Layer.effect(Mailer)(/* prod impl */)
  static readonly testLayer = Layer.succeed(Mailer)(/* test impl */)
}
```

**Why.** effect-solutions picks specific names: `layer` (production) and `testLayer` (lightweight test implementation). Being consistent with the rest of the ecosystem's docs helps — readers who've read one tutorial recognise the same shape everywhere.

**Pros**
- Matches the convention in effect-solutions, Effect source, `@effect/vitest` examples.
- `readonly` flags them as intentional public API rather than mutable state.
- `testLayer` is a strong signal: "this is the seam you're meant to swap".

**Cons**
- Loses the `Live` naming that some codebases (including tbiz_ts) use consistently.
- Renaming across a large codebase is a chore.

**Keep the old form when.** Existing codebases that are internally consistent — don't rename just for rename's sake.

## 10. Service methods wrapped in `Effect.fn`

Repeat of §1 but specifically inside service impls:

```ts
class UsersImpl {
  static readonly layer = Layer.effect(Users)(
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient

      const findById = Effect.fn("Users.findById")(function* (id: UserId) {
        const resp = yield* http.get(`/users/${id}`)
        return yield* decodeUser(resp)
      })

      return { findById }
    }),
  )
}
```

**Why.** Every service method is an API surface. Naming them `Service.method` gives your traces instant structure — `Users.findById` is enormously more useful than anonymous spans.

**Cons.** Slightly more scaffolding than a bare arrow. Worth it for anything that'll run in production.

## 11. Service-driven development sketch

**New section.** Demonstrates writing leaf tags (`Users`, `Emails`) first with no implementations, then writing higher-level orchestration (`Notifier`) on top. Everything type-checks immediately.

**Pros**
- Lets you stabilise the *shape* of the system without picking infra.
- Catches API mismatches early.
- Makes test swaps trivial — you decided the swap points before implementing anything.

**Cons**
- Requires thinking at the architecture level up-front — not always natural for tight feature loops.
- Overkill for a three-service app.

## 12. Layer memoization gotcha

**New section.** Parameterized layer constructors called inline twice produce two instances:

```ts
// ❌ Two Postgres pools, 20 connections total
Layer.mergeAll(
  UserRepo.layer.pipe(Layer.provide(Postgres.layer({ url, poolSize: 10 }))),
  OrderRepo.layer.pipe(Layer.provide(Postgres.layer({ url, poolSize: 10 }))),
)

// ✅ Shared pool
const pgLayer = Postgres.layer({ url, poolSize: 10 })
Layer.mergeAll(
  UserRepo.layer.pipe(Layer.provide(pgLayer)),
  OrderRepo.layer.pipe(Layer.provide(pgLayer)),
)
```

**Why it matters.** Effect memoizes layers by *reference identity*. Two inline calls are two references. In development you'd never notice; in production you'd hit the database connection limit and wonder why.

## 13. `Config.schema(BrandedSchema, "ENV")` for validation

**Before**
```ts
const port = yield* Config.number("PORT").pipe(
  Config.mapOrFail((n) =>
    n > 0 && n < 65536 ? Effect.succeed(n) : Effect.fail(ConfigError.InvalidData([], "...")),
  ),
)
```

**After**
```ts
const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  Schema.brand("Port"),
)
const port = yield* Config.schema(Port, "PORT")
```

**Why.** The `Port` schema is now reusable at every boundary — config, HTTP params, form fields. One source of truth. Schema's validation messages are richer than ad-hoc `Config.mapOrFail` failures.

**Pros**
- Single schema, used everywhere.
- Full Schema machinery available (brand, transform, NullOr, whatever).
- Cleaner read: intent visible from the schema type, not a separate predicate.

**Cons**
- Tiny values (a default-4 second timeout) can feel like overkill to schemify.
- Schema error messages differ from Config error messages — error-handling code may need tweaks when migrating.

**Keep the old form when.** One-off config values with no domain meaning outside that config slot.

## 14. "Skip ConfigProvider in tests" guidance

The advice: don't mock `process.env`. Provide the config service's `testLayer` directly.

```ts
Effect.runPromise(program.pipe(Effect.provide(AppConfig.testLayer)))

// Or per-test:
Effect.runPromise(
  program.pipe(
    Effect.provide(Layer.succeed(AppConfig, {
      host: "localhost", port: /* ... */, env: "development", apiKey: Redacted.make("k"),
    })),
  ),
)
```

**Pros**
- Each test can specialise its own config without mutating env vars.
- No coupling to `process.env` shape.
- Tests survive env-variable renames in the production code unchanged.

**Cons**
- Production code paths that *do* use `ConfigProvider` aren't exercised in tests — if you misname an env var, you won't see it until deploy.
- Slight duplication: test values repeated across tests. Worth writing a `makeTestConfig(overrides)` helper.

## 15. `makeTestLayer(seed)` factory convention

Instead of a single `static testLayer` that's always the same, expose a factory:

```ts
class Users extends Context.Service<Users, UsersShape>()("test/Users") {
  static readonly makeTestLayer = (db: Record<string, string>) =>
    Layer.succeed(Users)({ get: (id) => /* read from db */ })
}

// In a test:
const runtime = ManagedRuntime.make(Users.makeTestLayer({ "1": "Ridho" }))
```

**Pros**
- Each test sets up its own seed data — no shared mutable state leaking across tests.
- Reads naturally: "give me a Users service initialised with this data".

**Cons**
- For simple tests where no parameterization is needed, an extra call is visual noise.
- Adds one more class member per service — cost per service, not per test.

**Use `testLayer` when** the service has no meaningful parameterization (e.g. a pure stateless echo).
**Use `makeTestLayer` when** different tests want different seed data / different faked behaviour.

## What the alignment did **not** change

We kept these deliberately:

- **`Context.Service` everywhere** — effect-solutions documents `ServiceMap.Service` but that module was renamed in beta.57. Our version is correct for the installed runtime.
- **`Effect.match` / `Effect.matchEffect`** — effect-solutions references `Effect.catch` but that export doesn't exist in beta.57; `match` + `catchTag` are the current shape.
- **`Schedule.both` instead of `Schedule.intersect`** — same renamed-in-beta.57 story.
- **`ConfigProvider.fromUnknown` with nested objects** — the beta.57 behaviour reads by literal path segments, not by splitting on `_`.
- **Branded construction via `Schema.decodeUnknownSync(Brand)(value)`** — `.makeUnsafe` isn't exposed on branded schemas yet.
- **`bun:test` for the testing chapter** — the CLAUDE.md mandate overrides effect-solutions' `@effect/vitest` recommendation. The chapter now opens with an explicit trade-off note so readers know what they'd gain from `@effect/vitest` and when to bring it in as a project exception.

## When to re-audit

When the effect version bumps:

- Check whether `Schema.make` / `.makeUnsafe` ships on branded schemas (story 02 can then drop the `decodeUnknownSync(Brand)` workaround).
- Check whether `Effect.catchAll` returns (story 01 + audit both claim it doesn't exist in beta.57).
- Check whether `ServiceMap` comes back as an alias (story 05's version-skew note may become obsolete).
- Re-run `effect-solutions show basics services-and-layers data-modeling error-handling config testing` and diff against our chapters.
