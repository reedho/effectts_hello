# Audit: storybook/docs vs. effect-solutions recommendations

> Checked on 2026-04-24 against `effect-solutions show {basics,services-and-layers,data-modeling,error-handling,config,testing,project-setup,tsconfig}`, cross-referenced with the installed `effect@4.0.0-beta.57` type definitions.
>
> **Status:** aligned on a follow-up pass. See the "Applied changes" section at the bottom. beta.57-specific corrections (`Context.Service`, `Effect.match` instead of the non-existent `Effect.catchAll`, `Schedule.both` instead of the older `Schedule.intersect`) are preserved.

## Summary

| Topic | Verdict |
| --- | --- |
| Project setup / tsconfig | 🟢 Aligned |
| Effect basics | 🟡 Missing `Effect.fn` |
| Services & layers | 🟡 Correct for beta.57, but convention drift |
| Data modeling | 🟠 Uses older idioms (`Struct` over `Class`) |
| Error handling | 🟠 Wraps yieldable errors; no defect story |
| Config | 🟡 Missing `Config.schema` |
| Testing | 🟡 Uses `bun:test` (project mandate), not `@effect/vitest` |

## Per-topic findings

### 1. Basics — 🟡

**What's missing: `Effect.fn`.** effect-solutions treats this as the idiomatic way to declare named, traced effectful functions. It exists in beta.57 (`Effect.fn("name")(function* () { ... })`) but appears nowhere in our stories or docs.

**Impact:** service methods, business-logic functions, and everything that benefits from call-site tracing / span integration is written as plain arrow-over-gen. OK for learning, but users following the storybook won't know to reach for `Effect.fn` in real code.

**Suggested fix:** expand chapter 01 or add a small "naming effects" section showing `Effect.fn("User.findById")(function* (id) { ... })`; use it for service methods in chapter 05's examples.

### 2. Services & Layers — 🟡

**Version skew (not a bug).** effect-solutions still documents `ServiceMap.Service`. In our installed `effect@4.0.0-beta.57`, `ServiceMap` does not exist — it was renamed to `Context`. Our stories/docs already call this out. No action beyond continuing to flag it.

**Convention drift.** effect-solutions standardizes:
- `static readonly layer` (lowercase) — we use `static Live`
- `static readonly testLayer` — we use `static Mock`
- Service methods defined via `Effect.fn("Service.method")(...)` — we use plain arrow functions

**Missing topics:**
- **Service-driven development** — sketching leaf tags first, implementing later.
- **Layer memoization gotcha** — parameterized layer constructors must be stored in a const before reuse, or you get duplicate connection pools.
- **`Effect.provide` once at the top** — we show it, but never call it out as a discipline.

### 3. Data modeling — 🟠

Largest idiom gap in the codebase.

| What we use            | What effect-solutions recommends        |
| ---------------------- | --------------------------------------- |
| `Schema.Struct({...})` | `Schema.Class("Name")({...})` with methods |
| `Data.TaggedError`     | `Schema.TaggedErrorClass("Tag")(...)` (serializable, Schema-integrated) |
| Brand only IDs         | Brand nearly every domain primitive (Email, Port, Percentage, URL, ...) |
| `JSON.parse` + decode  | `Schema.fromJsonString(Schema)` one-step |
| `switch` on `_tag`     | `Match.valueTags(value, {...})` |

All of these exist in beta.57 (`Schema.Class`, `Schema.TaggedClass`, `Schema.TaggedErrorClass`, `Schema.fromJsonString`, `Match.valueTags` are all exported). We're simply using the shape common in tbiz_ts (which predates the Schema class recommendation) rather than the official current guidance.

**Impact:** readers learn the older style. Still correct, but they'll later need to unlearn it.

**Suggested fix:** rework chapters 02 and 04 to lead with `Schema.Class` / `Schema.TaggedErrorClass`, with a short note that `Schema.Struct` + `Data.TaggedError` remain supported for simpler cases.

### 4. Error handling — 🟠

**Yieldable errors.** Our code does:

```ts
return yield* Effect.fail(new ApiError({ ... }))
```

The language-service actually flagged this with `unnecessaryFailYieldableError` during our typecheck run. effect-solutions documents that `Schema.TaggedError`/`Data.TaggedError` values are yieldable directly:

```ts
yield* new ApiError({ ... })   // equivalent, preferred
```

**No defects story.** effect-solutions distinguishes **typed errors** (recoverable) from **defects** (unrecoverable, terminate the fiber). It teaches `Effect.orDie`, `Schema.Defect`, and the "at the system boundary only" discipline for `catchAllDefect`. We never mention any of these. This is a real production gap — config failures, programmer bugs, invariant violations all want defect handling, not typed errors.

**Suggested fix:** add a "defects vs. typed errors" section in chapter 04, show `Effect.orDie` and `Schema.Defect` for wrapping unknown errors from external libs.

### 5. Config — 🟡

**Missing: `Config.schema(SchemaType, "ENV_VAR")`.** effect-solutions explicitly recommends `Config.schema` over `Config.mapOrFail` for validation. It integrates with branded types and Schema refinements:

```ts
const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  Schema.brand("Port"),
)
const port = yield* Config.schema(Port, "PORT")
```

This ties chapters 03 and 06 together nicely — branded config values with Schema-driven validation. Worth adding.

### 6. Testing — 🟡

**We use `bun:test` by explicit project mandate** (CLAUDE.md says "Use `bun test` instead of `jest` or `vitest`"). effect-solutions recommends `@effect/vitest` for:

- `it.effect(...)` — auto-runs Effects, auto-provides `TestContext`
- `TestClock` / `TestRandom` for deterministic time/randomness
- `it.layer` for suite-shared layers
- `it.live` for real-time tests
- Automatic scope cleanup

None of these are available via `bun:test`. Our tests work, but they won't model time-dependent behavior, flaky-test scheduling, or scoped resource cleanup the way Effect programs need in real codebases.

**Decision point for the user:** either (a) keep the CLAUDE.md mandate and document the trade-off, or (b) carve out `@effect/vitest` as a project-level exception for Effect tests specifically.

### 7. Project setup / tsconfig — 🟢

- ✅ `@effect/language-service` installed and patched via `prepare`.
- ✅ `.vscode/settings.json` pins workspace TS.
- ✅ `strict`, `exactOptionalPropertyTypes`, `noImplicitOverride` on.
- ✅ `verbatimModuleSyntax`, `moduleResolution: bundler`, `module: Preserve`.
- ⚠️ `noUnusedLocals` and `noUnusedParameters` are currently `false`. effect-solutions doesn't enforce these; leaving as-is is fine.
- ⚠️ No `incremental: true`. Worth adding for faster typecheck on repeat.

## What I'd change first

If we want the storybook to teach current-best-practice Effect rather than the tbiz_ts-era flavor:

1. **Chapter 02 — Data modeling** → rewrite around `Schema.Class`; keep `Struct` as a footnote for ad-hoc shapes.
2. **Chapter 04 — Errors** → `Schema.TaggedErrorClass` + yieldable-without-`fail`; add a "Defects vs. typed errors" section with `Effect.orDie` and `Schema.Defect`.
3. **Chapter 05 — Services** → rename `Live`/`Mock` → `layer`/`testLayer`; introduce `Effect.fn` for methods; add "service-driven development" sketch.
4. **Chapter 06 — Config** → introduce `Config.schema(BrandedSchema, "ENV")`.
5. **Chapter 10 — Composition** → introduce `Effect.fn` as the preferred function-declaration form; mention `Effect.withSpan`.

Chapters 07 (HTTP) and 08 (runtime) are already in line with recommendations. Chapter 11 (testing) is explicitly a `bun:test` variant — leave it but link to the `@effect/vitest` approach for production-ish tests.

## Applied changes

All five priority fixes and the extras landed in-place. Summary:

- **Story 01 + doc 01** — added an `Effect.fn` section; retained the `Effect.match` correction (no `catchAll` in beta.57).
- **Story 02 + doc 02** — rebuilt around `Schema.Class` (with a `displayName` getter), `Schema.TaggedClass` + `Match.valueTags`, branded primitives (Email, Port, UserId, PostId), `Schema.fromJsonString`. `Schema.Struct` now appears only as an aside.
- **Story 04 + doc 04** — migrated to `Schema.TaggedErrorClass` with direct `yield* new Err(...)` yielding; added a defects section (`Schema.Defect`, `Effect.orDie`, `Effect.catchDefect`). Kept one `Data.TaggedError` example as a "legacy" note for tbiz_ts readers.
- **Story 05 + doc 05** — renamed `Live`/`Mock` → `layer`/`testLayer`; wrapped every service method in `Effect.fn("Svc.method")`; added a "service-driven development" sketch and a "layer memoization" gotcha section. Retained the `Context.Service` vs `ServiceMap.Service` version note.
- **Story 06 + doc 06** — added `Config.schema(BrandedSchema, "ENV")`; switched the config service to `layer`/`testLayer`; added the "skip ConfigProvider in tests, just use testLayer" guidance.
- **Story 10 + doc 10** — led with `Effect.fn` (including the two-arg instrumented form); added `Effect.withSpan`; kept `Schedule.both` correction.
- **Story 08, 09, 11** — minor consistency updates (layer naming, `Schema.TaggedErrorClass`, yieldable errors, testLayer convention). Story 11 now opens with an explicit `bun:test` vs `@effect/vitest` trade-off note.

All 10 runnable stories still execute cleanly; all 6 tests still pass.
