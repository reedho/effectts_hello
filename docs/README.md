# Effect-TS v4 Tutorials

Short, focused tutorials — one per storybook entry. Read top-to-bottom the first time; after that, jump to whichever chapter covers the problem you have today.

Each chapter pairs with a runnable file in [`../stories/`](../stories/). The tutorials explain the *why*; the code shows the *how*. Run a chapter's code with:

```bash
bun stories/<chapter>.ts          # 01 .. 10
bun test stories/11-testing.test.ts
```

## Chapters

1. [Basics](./01-basics.md) — `Effect.gen`, success/failure, running an Effect
2. [Schema data modeling](./02-schema-data-modeling.md) — shapes, unions, tuples, brands
3. [Schema validation & decode](./03-schema-validation-and-decode.md) — `check`, filters, `decodeUnknownExit`
4. [Tagged errors](./04-tagged-errors.md) — `Data.TaggedError`, `catchTag`
5. [Services & Layers](./05-services-and-layers.md) — dependency injection
6. [Config & providers](./06-config-and-providers.md) — env vars, redacted secrets
7. [HTTP client](./07-http-client.md) — `effect/unstable/http`
8. [ManagedRuntime](./08-managed-runtime.md) — running Effects from non-Effect code
9. [JSON-RPC schema factory](./09-jsonrpc-schema-factory.md) — generic schemas + mock HttpClient
10. [Composing effects](./10-composing-effects.md) — `all`, `forEach`, `cachedWithTTL`, retries
11. [Testing](./11-testing.md) — Bun-test + `Exit`

## Version note

These tutorials target `effect@4.0.0-beta.57` (effect-smol, which consolidated `@effect/platform` into core). The reference source — `tbiz_ts` — was written against `effect@4.0.0-beta.31`. The user-facing API is 95% identical; the handful of v4.31 → v4.57 differences are called out inline where they matter.
