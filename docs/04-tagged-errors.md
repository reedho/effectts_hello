# 04 — Tagged errors

> Story: [`stories/04-tagged-errors.ts`](../stories/04-tagged-errors.ts)
> Reference: [`tbiz_ts/packages/api-client/src/error.ts`](../../../works/tbiz_ts/packages/api-client/src/error.ts), [`.../rpc-client/src/errors.ts`](../../../works/tbiz_ts/packages/rpc-client/src/errors.ts)

## Why tagged errors?

Plain `Error` subclasses merge together in Effect's error channel — you lose the ability to handle each one distinctly at the type level. Tagged errors fix this by giving every error class a literal `_tag` field that TypeScript can narrow on.

```ts
class ApiError extends Data.TaggedError("ApiError")<{
  readonly code: string
  readonly message: string
  readonly status?: number
  readonly cause?: unknown
}> {}

class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string
  readonly code: "TOKEN_EXPIRED" | "TOKEN_INVALID" | "UNAUTHORIZED"
}> {}
```

Each class:
- has a literal `_tag` property (e.g. `"ApiError"`)
- is constructed with `new ApiError({ code: "E_400", message: "…" })`
- supports structural equality (via `Data`)
- has a stack trace

## Failing with a typed error

```ts
const fetchUser = (id: string): Effect.Effect<User, ApiError | AuthError> =>
  Effect.gen(function* () {
    if (!id) {
      return yield* Effect.fail(
        new ApiError({ code: "EBAD", message: "id is required", status: 400 }),
      )
    }
    // ...
  })
```

The union in the return type (`ApiError | AuthError`) is the signature the caller sees. No surprises — if a function claims it can fail with `X | Y`, those are the only typed failures possible.

## Handling errors by `_tag`

`Effect.catchTag` narrows on `_tag`:

```ts
const withRefresh = pipe(
  fetchUser(id),
  Effect.catchTag("AuthError", (e) =>
    // e is narrowed to AuthError here
    Effect.succeed({ id: "guest", name: `fallback (was ${e.code})` }),
  ),
)
```

The error channel afterward is `ApiError` only — `AuthError` has been handled.

For several tags at once, `Effect.catchTags` takes a record:

```ts
const handled = pipe(
  fetchUser(id),
  Effect.catchTags({
    ApiError:     (e) => Effect.succeed(`API ${e.code}: ${e.message}`),
    AuthError:    ()  => Effect.succeed("please log in"),
    NetworkError: (e) => Effect.succeed(`retry later: ${e.message}`),
  }),
)
```

If you handle every tag in the union, the remaining error channel is `never`.

## Lifting errors at service boundaries

A common pattern in `tbiz_ts/packages/api-client/src/qilin/common.ts`: catch low-level errors from Effect libraries (`HttpBodyError`, `ConfigError`, `HttpClientError`) and lift them into your domain error type, so callers only deal with `ApiError`:

```ts
const call = doCallApi(req).pipe(
  Effect.mapError((e): ApiError =>
    e instanceof ApiError
      ? e
      : new ApiError({ code: "E_WRAP", message: e.message, cause: e })
  ),
)
```

Or, tag by tag:

```ts
pipe(
  program,
  Effect.catchTag("HttpBodyError", (e) =>
    Effect.fail(new ApiError({ code: "EREQ", message: "bad body", cause: e })),
  ),
  Effect.catchTag("HttpClientError", (e) =>
    Effect.fail(new ApiError({ code: "ERESP", message: e.message, cause: e })),
  ),
)
```

Either shape works. The point is: **your service exposes your errors**, not someone else's.

## Design rule

One tagged error class per meaningful failure mode in your domain. Too few (e.g. a single `DomainError`) and you lose the precision that makes `catchTag` useful. Too many and the union types get unwieldy.

Look at [`packages/rpc-client/src/errors.ts`](../../../works/tbiz_ts/packages/rpc-client/src/errors.ts) for a reasonable middle — four tagged errors (`RpcError`, `NetworkError`, `ParseError`, `AuthError`) covering everything a JSON-RPC client can fail on.

## Takeaways

- `Data.TaggedError("Tag")<Payload>` creates a structural, narrowable error class.
- `Effect.catchTag("Tag", fn)` handles one case and removes it from `E`.
- `Effect.catchTags({...})` handles several at once.
- Lift third-party errors into your domain type at service boundaries.
