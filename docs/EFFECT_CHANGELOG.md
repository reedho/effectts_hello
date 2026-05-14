# Effect changelog (curated)

> Brief, codebase-relevant summary of `effect@4.0.0-beta.*` releases — only items that touch this storybook's surface (Schema, Effect, Layer, Context, Config, unstable/http, tagged errors, testing).
>
> Skipped: AI / LanguageModel / EmbeddingModel, MCP, Workflow, Cluster, RPC internals, CLI prompt UX, Atom reactivity. Read [`packages/effect/CHANGELOG.md`](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/CHANGELOG.md) for the full list.
>
> Baseline: `tbiz_ts` was authored against beta.31. This codebase targets **beta.66** (latest published).

## Quick map: which changes touch our chapters

| Chapter | Sensitive to                                                              |
| ------- | ------------------------------------------------------------------------- |
| 01 Basics | `Effect.fn` arity (b22), `Effect.findFirst` (b21), `Effect.context()` default (b27), `runSync` async error (b37), `Effect.tx` rename (b42), `Effect.abortSignal` (b57), `Effect.firstSuccessOf` (b61), `Effect.match{,Effect}` shape — `catchAll` removed |
| 02 Schema modeling | `OptionFromOptionalNullOr` (b32), `Newtype` (b29), `Chunk` schema (b24), `ArrayEnsure` (b35), `StringFromBase64`/`Hex`/`UriComponent` + `*FromString` decoders (b44), `DurationFromString` (b60), JSON-Schema `enum` collapse (b41), `toCodecJson` typed `Json` (b31) |
| 03 Validation | `Schema.makeFilter` `{path,issue}` rename + `FilterIssue[]` (b51), `decodeUnknownResult`/`encodeUnknownResult` (b36), `MakeOptions.disableChecks` rename (b38), `decodeUnknownExit` unchanged |
| 04 Tagged errors | `Schema.TaggedErrorClass` instance `name = tag` (b28), `withConstructorDefault` accepts `Effect<T>` (b44), **`Effect.Yieldable` type removed (b66)** — `yield* new MyError(...)` still works via iterator protocol; only explicit type references break |
| 05 Services & layers | `ServiceMap` → `Context` rename (b57), `Layer.suspend` (b43), `Layer.tap`/`tapError`/`tapCause` (b32), `Layer.mock` is dual + works with Stream/Channel (b31/b35), Layer unification fix (b44), `Effect.acquireDisposable` (b63) |
| 06 Config & providers | `Config.Success` type util (b35), `Config.literals` convenience (b60), `Config.schema(...)` unchanged, `ConfigProvider.fromUnknown` no `_`-split — pass nested objects |
| 07 HTTP client | `HttpClient.withRateLimiter` (b24, b25 polish), `HttpClientResponse` pipeable (b30), partial-stream abort (b29), URL builder + encoded params (b38/b39), `responseMode: "response-only"` (b38), `bodyJson` returns `Effect<Request>` |
| 08 ManagedRuntime | Tracks fibers in a scope (b41) |
| 09 JSON-RPC | `decodeJsonRpcRaw` array branch removed (b35), falsey `id` (`0`, `""`) accepted (b43), `RpcSerialization.makeMsgPack` for Cloudflare workers (b51) |
| 10 Composing | `Effect.cachedWithTTL` start-on-value (b36), `Schedule.intersect` → `Schedule.both` (b39 deprecation, removed by b57), `Effect.repeat` returns inner value (b44), retry/repeat narrowing (b33) |
| 11 Testing | `TestClock.currentTimeNanosUnsafe` floor fix (b53), `Layer.mock` ergonomics (b31), `Effect.ignore` accepts message (b30), `HttpApiTest` module (b63) for HttpApi integration tests |

## Per-version highlights

### 4.0.0-beta.66 — **codebase target**
- **`Effect.Yieldable` type removed.** Tagged-error / yieldable instances still work via the iterator protocol (`yield* new MyError(...)` is fine), but code that explicitly references the `Effect.Yieldable` *type* breaks. Verified on bump: story 04 uses only the value form, no source changes needed.
- `Schema.Struct` field types preserve IDE provenance (`Type_<>` rewritten with `keyof F as …`): Go-to-Definition now jumps to the originating Struct field. Pure DX win.
- `HttpApiTest.groups` accepts an optional `baseUrl` override (default `"http://localhost:3000"`).
- HTTP server logger log span names lose their auto-increment suffix.
- (Non-storybook) `DurableQueue` (unstable workflow); RPC server HTTP finalizer ID tracking fix.

### 4.0.0-beta.65
- New SQL error reason **`UniqueViolation`** — was previously bucketed under `ConstraintError`. PostgreSQL, PGlite, MySQL, MSSQL, and the SQLite-family clients now distinguish unique-constraint failures. `UniqueViolation.constraint` carries the best available identifier (falls back to `"unknown"`).

### 4.0.0-beta.64
- (SQL only) `SqlModel` repositories/resolvers gain optional soft-delete column support. Not exercised by storybook.

### 4.0.0-beta.63
- **`HttpApiTest` module** for HttpApi integration tests (chapter 11 candidate if we add an HttpApi server story).
- **`Effect.acquireDisposable`** — companion to `acquireRelease` that consumes a `Disposable` (web standard) directly.

### 4.0.0-beta.62
- Narrow K8s schema relaxation (`lastTransitionTime` nullable). No storybook impact.

### 4.0.0-beta.61
- **`Effect.firstSuccessOf` ported from Effect v3** — runs effects in order, returns the first success, fails with the last failure if all fail. Useful in chapter 10 (composition) examples.
- `HttpApiBuilder` correctly decodes empty bodies.
- Fiber-runtime start metrics recorded at construction (yielded fibers no longer double-counted).

### 4.0.0-beta.60
- **`Schema.DurationFromString`** + `SchemaTransformation.durationFromString`. `Duration.fromInput` now accepts `"Infinity"` / `"-Infinity"`. Config duration parsing simplified around the shared schema codec.
- **`Config.literals`** — convenience constructor for `Schema.Literals` configs.
- `Inspectable.stringifyCircular` removed; `Formatter.formatJson` preserves shared (non-circular) object references and only elides true cycles.
- `Duration.Input` accepted directly by duration accessors.
- `SchemaTransformation` decode messages normalized: `urlFromString` no longer leaks raw `URL` errors (now `"Invalid URL string: …"`), `dateTimeUtcFromString` reports `"Invalid UTC DateTime string: …"`, and `dateTimeZonedFromString` capitalizes `Zoned`. Matters only if you snapshot/compare these strings.
- (RPC) `Rpc.custom`.

### 4.0.0-beta.59
- (RPC only) Entity-proxy RPC handlers now provide the context expected by `RpcServer`. No storybook impact.

### 4.0.0-beta.58 *(2026-04-26)*
- Reactivity `AsyncResult.exhaustive()` finalizer.
- HTTP body consumption + stream → binary array allocation improvements.

### 4.0.0-beta.57 *(2026-04-22)*
- **`ServiceMap` module renamed to `Context`** — use `Context.Service<Self, Shape>()('id')`. Memory note `effect-4-0-0-beta-57-effect-smol` covers the full delta.
- `Effect.abortSignal` for AbortSignal-driven cancellation.
- Each SQL client gets a unique transaction service.
- (Carried-over caveats from earlier betas: `Effect.catchAll` gone — use `match` / `matchEffect` / `catchTag`; `Schedule.intersect` → `both`; `Schema.withDecodingDefault` takes `Effect<Encoded>`.)

### 4.0.0-beta.55–56
- `Schema.encodeKeys` interface exported (fixes TS4023 when re-exporting values whose inferred type referenced it).
- `isNullish` predicate fixed.

### 4.0.0-beta.54
- `Socket.make` constructor.
- Workflow failure not squashed by suspension interrupt.

### 4.0.0-beta.53
- `TestClock.currentTimeNanosUnsafe()` floors fractional ms before `BigInt` conversion.
- `Latch.release` fix.
- `HttpIncomingMessage.schemaBodyJson` forwards `parseOptions`.
- New `Effectable` module.

### 4.0.0-beta.52
- `HttpApiSchemaError` distinguishes schema error origin; HttpApi schema errors become defects unless explicitly transformed.
- Tagged-enum `_tag` correctness fix.

### 4.0.0-beta.51
- **Schema breaking**: `makeFilter` shape renamed `{path, message}` → `{path, issue}`. `FilterOutput` accepts `ReadonlyArray<FilterIssue>` for multi-failure filters (no more hand-rolled `Issue.Composite`).
- `RpcSerialization.makeMsgPack` (Cloudflare Workers compat — disable msgpackr `useRecords`).
- `SchemaAST.isJson` accepts DAGs; only true cycles are rejected.
- `OpenApi.fromApi` drops the unused `options` parameter.
- Schema property/element validation can run concurrently.

### 4.0.0-beta.50
- Deferred RPC responses; serializable `AtomRpc.query` requires explicit option.

### 4.0.0-beta.49
- `HttpApiSchema.status("Created")` accepts string literals.
- `RpcGroup.omit`.

### 4.0.0-beta.48
- HttpApi handlers omit `Scope` from environment.

### 4.0.0-beta.47
- `Schema.annotateEncoded` for annotating the encoded side.
- `Schema.withDecodingDefaultTypeKey` / `withDecodingDefaultType`.
- `Schema.Class` constructors accept `void` when all fields are optional.

### 4.0.0-beta.45
- `EventLogServerUnencrypted` module.

### 4.0.0-beta.44
- **Default-value APIs aligned**: `Schema.withConstructorDefault`, `Schema.withDecodingDefault[Key]`, and `SchemaGetter.withDefault` all now take `Effect<T>` (was thunk / Option callback). Enables effectful defaults.
- New schemas: `DateFromString`, `BigIntFromString`, `BigDecimalFromString`, `TimeZoneNamedFromString`, `TimeZoneFromString`, `DateTimeZonedFromString`, `StringFromBase64`, `StringFromBase64Url`, `StringFromHex`, `StringFromUriComponent`.
- `Effect.repeat` with options now returns the effect's value.
- `Atom`'s `Context` type renamed `AtomContext`.
- `schema.makeEffect(input, options?)` for Bottom + class-backed schemas — Effect-failing constructor returning `SchemaError`.
- `KeyValueStore.layerSql` (SQL-backed key-value store).
- `Unify.unify` correctly merges Layer unions.
- `Stream.toQueue` returns `Queue.Dequeue` and delegates to `Channel.toQueueArray`.
- CLI: `Flag.optional(Flag.boolean(...))` returns `Option.none` when omitted; `--no-<flag>` negation.

### 4.0.0-beta.43
- `Layer.suspend` for lazy/dynamic layer choice with normal sharing.
- JSON-RPC accepts falsey valid `id` values (`0`, `""`).

### 4.0.0-beta.42
- **`Effect.transaction` → `Effect.tx`**, `retryTransaction` → `txRetry`. `transactionWith` and `withTxState` removed. Nested `Effect.tx` composes into the active transaction.
- Socket close codes now treated as errors by default unless `closeCodeIsError` overridden.
- `Number.remainder` fixed for small floats in scientific notation.

### 4.0.0-beta.41
- `BigDecimal.sumAll` / `multiplyAll` (parity with Number/BigInt).
- JSON Schema collapses same-type literal branches to single `enum`.
- `ManagedRuntime` fibers tracked in a scope.
- `Context.Key` is covariant.

### 4.0.0-beta.40
- `Stream.timeoutOrElse`.

### 4.0.0-beta.39
- **`Schedule.compose` removed in favor of `Schedule.both`** (predecessor of beta.57's `intersect → both` rename).
- `Struct.pick` etc. preserve simplified shape (no raw `Pick<T, K>`).
- `HttpApiClient.urlBuilder` accepts `HttpApi.Any`; encodes params/query via endpoint schemas.
- `effect/References` re-exports logger / error reporter references.

### 4.0.0-beta.38
- **Schema rename**: `MakeOptions.disableValidation` → `disableChecks`. Constructor defaults now applied when `disableChecks` is true.
- HttpApiClient renames `withResponse` → `responseMode`; adds `responseMode: "response-only"` (raw `HttpClientResponse`, no decode).
- `useCodecs` option on `HttpClientEndpoint` constructors.

### 4.0.0-beta.37
- SQL drivers: structured `SqlError` reasons (Unknown fallback when native codes missing).
- HTTP request: `toWeb` / `fromWeb` for web `Request` interop.
- `Schedule.fixed` runs next iteration immediately when previous took longer than the interval.
- `Unify.unify` collapses `Effect` unions correctly again.
- `Effect.runSync` raises a clearer error when an async effect is run.
- `HttpServerResponse.fromWeb` preserves `Content-Type` from web `Response`.

### 4.0.0-beta.36
- `Effect.cachedWithTTL` and `cachedInvalidateWithTTL` now start TTL when value is **produced**, not when computation starts.
- `PubSub.publish` returns `false` on shutdown (matches `Queue.offer`).
- **Schema**: `decodeUnknownResult` / `decodeResult` and `encodeUnknownResult` / `encodeResult` for synchronous `Result`-based parsing.
- `Schema.Struct.Type<F>` works directly without going through `Schema.Schema.Type`.
- `Stream.scanEffect` no longer hangs / repeats initial state.
- `Equivalence.Date`.
- `LayerMap` supports key-derived `idleTimeToLive`.

### 4.0.0-beta.35
- `Schema.ArrayEnsure`.
- `Config.Success` type utility.
- `Effect.acquireRelease` release finalizers can depend on the surrounding environment.
- `Layer.mock` works with Stream and Channel.

### 4.0.0-beta.34
- New `Url` module (port of v3).
- `isMutableHashMap` / `isMutableHashSet`.
- `HttpApiMiddleware.layerSchemaErrorTransform`.

### 4.0.0-beta.33
- Narrowed types for `Effect.retry` / `Effect.repeat` `while` option.

### 4.0.0-beta.32
- `Schema.OptionFromOptionalNullOr`.
- **`Layer.tap`, `Layer.tapError`, `Layer.tapCause`** for effectful observation of layer success/failure without changing outputs.
- `Context.mutate` for batched updates.
- `Option<A>` replaces `undefined | A` in many APIs (breaking — explicit `Option`).
- HttpApi runtime failures: missing middleware / missing group implementations now produce actionable diagnostics.
- HttpApiError classes implement `HttpServerRespondable` (return directly from plain handlers).
- Graceful shutdown for HTTP servers.
- `Stream.merge` data-last with options dispatch fixed.
- `effect/NullOr` module removed.

### 4.0.0-beta.31 *(`tbiz_ts` reference baseline)*
- `Duration.Input` accepts `DurationObject` (`{ hours: 1, minutes: 30 }`, Temporal-style).
- `Schema.toCodecJson` returns `Codec<T, Json, RD, RE>` (was `unknown`); HTTP `.json` properties typed as `Effect<Schema.Json, E>`.
- `Layer.mock` is dual: `Layer.mock(Service)(impl)` and `Layer.mock(Service, impl)` both work.
- `decodeJsonRpcRaw` simplified (unreachable array branch removed).

### 4.0.0-beta.30
- `Effect.ignore` / `ignoreCause` accept optional `message` for log output.
- `HttpClientResponse` is pipeable.
- `TaggedUnion.match` uses `Unify` so branches can return distinct Effect types.

### 4.0.0-beta.29
- **`Newtype` module** added (use for nominal type wrappers without Schema overhead).
- HTTP client requests aborted when response streams consumed only partially.

### 4.0.0-beta.28
- `Schema.TaggedErrorClass` instances now have `name === tag` (matches `Data.TaggedError`).
- `HttpServerResponse.expireCookie` / `Cookies.expireCookie` for emitting expired cookies.
- `HttpServerResponse.fromClientResponse`, `HttpServerRequest.toClientRequest`, `fromClientRequest`, `toClientResponse` — full server↔client interop.
- New `effect/unstable/http/HttpStaticServer` module.

### 4.0.0-beta.27
- `Effect.context()` defaults to `Effect.context<never>()`.
- HttpApi schema-validation default error → `HttpApiError.BadRequestNoContent`.
- HttpApi fix: void responses now produce `Response.empty`.
- `Headers.removeMany`.

### 4.0.0-beta.26
- `Effect.catchTags` exposes optional `orElse` fallback parameter.

### 4.0.0-beta.25
- `Effect.forkScoped` data-first now correctly includes `Scope` in requirements.
- `HttpClient.withRateLimiter` consumes `Retry-After` headers.

### 4.0.0-beta.24
- **`HttpClient.withRateLimiter`** — integrate `RateLimiter` service with HTTP clients (response-header driven limit updates, automatic 429 retry).
- **`Schema.Chunk`** schema added.
- `Schema.toTaggedUnion` discriminant detection fixed for class-based schemas with unique-symbol tags.

### 4.0.0-beta.23
- SchemaRepresentation: only references for recursive schemas / those with `identifier` annotation.

### 4.0.0-beta.22
- `Effect.fn` preserves wrapped function `length` (arity).
- `Filter` simplified (removed `Args` type parameter).
- Process keep-alive moved from per-fiber intervals to `Runtime.makeRunMain`.

### 4.0.0-beta.21
- `Effect.findFirst` / `findFirstFilter` for short-circuiting effectful searches.
- Span parent-span linking fix.

## Watchlist (re-audit when bumping past beta.66)

Items the alignment doc (`CHANGES.md`) flagged as version-skewed, plus new items introduced by beta.59–66 — re-check when bumping:

- **`Effect.Yieldable` type removed (b66)** — chapter 04 documents yieldable tagged errors. Source uses only the value form (`yield* new MyError(...)`), which still works via iterator protocol. Verify on bump that no docs reference the type signature and that `Schema.TaggedErrorClass` / `Data.TaggedError` instances still yield cleanly.
- **`Effect.catchAll` reintroduction** — `match` / `matchEffect` / `catchTag` is the current shape.
- **`ServiceMap` alias** — story 05's version-skew note is moot if it returns.
- **`ConfigProvider.fromUnknown` env-style underscore split** — beta.57 reads literal path segments. If that lands, the nested-object workaround in story 06 simplifies.
- **`@effect/vitest` adopted (b57+)** — chapter 11 now uses `@effect/vitest`; `bun:test` retained for plain unit tests only.
- **`HttpApiTest` module (b63)** — if we add an HttpApi server story, this is the canonical test harness.

When bumping, re-run `effect-solutions show basics services-and-layers data-modeling error-handling config testing` and diff against our chapters.
