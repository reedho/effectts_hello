# Effect-TS v4 Storybook

A hands-on tour of Effect v4 idioms as used in [`tbiz_ts`](~/works/tbiz_ts).
Each story is **self-contained** and **runnable** with Bun — no monorepo, no external services.

> Effect version: `^4.0.0-beta.57` (effect-smol, consolidated `@effect/platform` into core).

## Run

```bash
bun stories/01-basics.ts
bun stories/02-schema-data-modeling.ts
# ...
bun test stories/11-testing.test.ts
```

Typecheck everything:

```bash
bun run typecheck
```

## Table of contents

| #  | File                                   | What you learn                                                             |
| -- | -------------------------------------- | -------------------------------------------------------------------------- |
| 01 | `01-basics.ts`                         | `Effect.gen` + `yield*`, `Effect.succeed/fail`, `runPromise` / `runSync`    |
| 02 | `02-schema-data-modeling.ts`           | `Struct`, `Literals`, `Union` (array), `Tuple`, `Record`, `brand`, `NullOr`, `optional` |
| 03 | `03-schema-validation-and-decode.ts`   | `check` + `isMinLength/isPattern`, `withDecodingDefault`, `decodeUnknownExit` / `Sync` / `Option` |
| 04 | `04-tagged-errors.ts`                  | `Data.TaggedError`, `Effect.catchTag`, union error types                   |
| 05 | `05-services-and-layers.ts`            | `ServiceMap.Service` + curried `Layer.succeed` / `Layer.effect`            |
| 06 | `06-config-and-providers.ts`           | `Config.all/nested/withDefault/redacted`, `Redacted`, `ConfigProvider.fromUnknown` + `.layer` |
| 07 | `07-http-client.ts`                    | `effect/unstable/http` — `FetchHttpClient`, `HttpClientRequest`, `filterStatusOk`, `catchTag("HttpClientError")` |
| 08 | `08-managed-runtime.ts`                | `ManagedRuntime.make`, `runPromiseExit`, `Exit.match`, `Cause.findErrorOption` |
| 09 | `09-jsonrpc-schema-factory.ts`         | Generic `Schema.Top` factories (JSON-RPC envelope) + mocked `HttpClient` layer |
| 10 | `10-composing-effects.ts`              | `Effect.cachedWithTTL`, `Effect.all`, `Effect.map/flatMap`, service composition |
| 11 | `11-testing.test.ts`                   | Bun-test + `Schema.decodeUnknownExit` + `Exit.isSuccess/isFailure`          |

## Where each pattern lives in tbiz_ts

| Topic                  | Source                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| ServiceMap + Layer     | `packages/auth/src/auth.ts`, `packages/api-client/src/qilin.ts`    |
| Tagged errors          | `packages/api-client/src/error.ts`, `packages/rpc-client/src/errors.ts` |
| Config + Redacted      | `packages/api-client/src/config.ts`, `packages/api-client/src/example/service_config.ts` |
| HTTP client (v4)       | `packages/api-client/src/qilin/common.ts`, `.../pegasus.ts`         |
| ManagedRuntime         | `apps/b2c-studio/src/services/qilin.ts`                             |
| Schema factories       | `packages/rpc-client/src/schemas/jsonrpc.ts`                        |
| Form validators        | `packages/rpc-client/src/form/validators.ts`                        |
| Validation schemas     | `packages/rpc-client/src/schemas/auth.ts`                           |
| Tests                  | `packages/api-client/src/__tests__/insurance.test.ts`               |

## v3 → v4 cheat sheet

The biggest trap: **`Layer.effect` and `Layer.succeed` are now curried**.

```ts
// v3 (old, DON'T)
Layer.effect(MyService, Effect.gen(function* () { ... }))

// v4 (new)
Layer.effect(MyService)(Effect.gen(function* () { ... }))
```

See the full migration table in [`/home/ridho/works/tbiz_ts/EFFECT_V4_MIGRATION.md`](../../../works/tbiz_ts/EFFECT_V4_MIGRATION.md).
