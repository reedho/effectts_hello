# 07 — HTTP client (`effect/unstable/http`)

> Story: [`stories/07-http-client.ts`](../stories/07-http-client.ts)
> Reference: [`tbiz_ts/packages/api-client/src/qilin/common.ts`](../../../works/tbiz_ts/packages/api-client/src/qilin/common.ts), [`.../pegasus.ts`](../../../works/tbiz_ts/packages/api-client/src/pegasus.ts)

## v4 repackaging

In v3, HTTP lived in `@effect/platform` / `@effect/platform-browser`. v4 consolidated it into core under `effect/unstable/http`. **One** dependency — remove `@effect/platform*` from `package.json`:

```diff
- import { HttpClient } from "@effect/platform"
- import { FetchHttpClient } from "@effect/platform"
+ import { HttpClient, FetchHttpClient } from "effect/unstable/http"
```

## The request → response pipeline

The recipe, distilled from `qilin/common.ts` and `pegasus.ts`:

1. Grab the `HttpClient` from context
2. Optionally decorate it — `filterStatusOk` (turn non-2xx into errors), `mapRequest` (prepend a base URL)
3. Build a request with `HttpClientRequest.post(url)` + `bodyJson(...)`
4. Execute — `client.execute(req)` → `HttpClientResponse`
5. Parse the body — `response.json`
6. Decode with a Schema
7. Lift `HttpBodyError` / `HttpClientError` into your domain error type

```ts
const echoSomething = (payload: { greet: string }) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const okClient = client.pipe(HttpClient.filterStatusOk)

    // bodyJson returns Effect<HttpClientRequest, HttpBodyError>
    // — yield it to unwrap before passing to execute.
    const req = yield* HttpClientRequest.post(`${BASE}/echo`).pipe(
      HttpClientRequest.bodyJson(payload),
    )

    const response = yield* okClient.execute(req)
    const json = yield* response.json
    return Schema.decodeUnknownSync(EchoResponse)(json)
  }).pipe(
    Effect.catchTag("HttpBodyError", (e) =>
      Effect.fail(new ApiError({ code: "EREQ", message: JSON.stringify(e.reason), cause: e })),
    ),
    Effect.catchTag("HttpClientError", (e) =>
      Effect.fail(new ApiError({ code: "ERESP", message: e.message, cause: e })),
    ),
  )
```

## Key primitives

| Function | What it does |
|---|---|
| `HttpClient.HttpClient` | Service tag — provided by `FetchHttpClient.layer` |
| `FetchHttpClient.layer` | `Layer` binding the tag to the global `fetch` |
| `HttpClient.filterStatusOk` | Decorate a client so non-2xx responses fail with `StatusCodeError` |
| `HttpClient.mapRequest(fn)` | Decorate a client to transform every outgoing request |
| `HttpClientRequest.prependUrl(base)` | Prepend a base URL to the path |
| `HttpClientRequest.post(url)` | Start building a POST |
| `HttpClientRequest.bodyJson(body)` | Add a JSON body (returns `Effect<Request, HttpBodyError>`) |
| `HttpClientRequest.bodyJsonUnsafe(body)` | Same but throws on unserializable input |
| `HttpClientRequest.setHeader(k, v)` | Single header |
| `HttpClientRequest.setHeaders({...})` | Bulk headers |
| `response.json` | `Effect<unknown, ResponseError>` — parsed body |

## A reusable prefixed client

```ts
const apiClient = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  return client.pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(BASE)),
    HttpClient.filterStatusOk,
  )
})

const call = Effect.gen(function* () {
  const client = yield* apiClient
  const req = yield* HttpClientRequest.post("/echo").pipe(
    HttpClientRequest.bodyJson({ via: "prefixed" }),
  )
  const resp = yield* client.execute(req)
  return yield* resp.json
})
```

This is the shape of `qilinClient` and `pgsClient` in tbiz_ts.

## Errors: catch `HttpClientError`, branch on `reason`

In v4 the **only** error in the channel is `HttpClientError` (`_tag: "HttpClientError"`) — that's why `filterStatusOk` types everything as `HttpClientError` and why the story does `catchTag("HttpClientError")`. There is **no** `catchTag("StatusCodeError")`: the specific failure lives on `error.reason`, a tagged union.

| `error.reason._tag` | side     | typical cause                                   |
| ------------------- | -------- | ----------------------------------------------- |
| `"TransportError"`  | request  | connection refused, DNS, socket (≈ v3 `RequestError`) |
| `"EncodeError"`     | request  | request body failed to encode                   |
| `"InvalidUrlError"` | request  | malformed URL                                   |
| `"StatusCodeError"` | response | non-2xx (e.g. after `filterStatusOk`) (≈ v3 `ResponseError`) |
| `"DecodeError"`     | response | response body failed to decode                  |
| `"EmptyBodyError"`  | response | expected a body, received none                  |

The reason groupings are `RequestError = TransportError | EncodeError | InvalidUrlError` and `ResponseError = StatusCodeError | DecodeError | EmptyBodyError`. Catch `"HttpClientError"` when you don't need granularity (as the story does); switch on `error.reason._tag` when you do. Schema decode failures (v3 `"ParseError"`) surface as `SchemaError` — see chapter 03.

`HttpBodyError.reason` also changed — it's now a tagged union (`{ _tag: "JsonError" } | { _tag: "SchemaError", issue }`). Stringify it or narrow by tag.

## Two small gotchas

1. **`bodyJson` returns an Effect.** Yield it first, or use `bodyJsonUnsafe` if you're sure the body is serializable.
2. **`HttpClient.make(fn)` validates the URL.** Even for mocks (chapter 9) you need an absolute URL — `"http://mock.local/rpc"` not `"/rpc"`.

## Schema decode of the response body

`HttpClientResponse.schemaBodyJson(schema)(response)` still exists in v4 and is the right tool for a concrete schema. We decode manually here only because the **generic** factory schema (chapter 9's `<R extends Schema.Top>`) can't satisfy its type constraints — for a fixed schema, prefer `schemaBodyJson`. The manual form:

```ts
const json = yield* response.json
const data = Schema.decodeUnknownSync(Response as any)(json) as Schema.Schema.Type<typeof Response>
```

`qilin/common.ts` uses this exact pattern. The `as any` is unfortunate but pragmatic.

## Other client decorators worth knowing

Two `HttpClient` decorators this chapter doesn't exercise but you'll reach for in production:

- **`HttpClient.withRateLimiter(client, rateLimiter)`** — route every request through a `RateLimiter` (token-bucket / fixed-window), the clean way to respect upstream quotas without hand-rolling throttling.
- **`HttpClient.retryTransient({ retryOn, while?, schedule? })`** — retry transient failures, where `retryOn` is `"errors-only"` (default), `"response-only"` (retry on retryable *responses*, e.g. 429/503), or `"errors-and-responses"`. Pair it with a `Schedule` (chapter 10) for bounded backoff.

Both compose the same way as `filterStatusOk` — decorate once, reuse everywhere.

## Takeaways

- Everything lives under `effect/unstable/http` now.
- Build requests with `HttpClientRequest.*`, then `yield*` the body-adding step.
- Decorate the client with `filterStatusOk` + `mapRequest(prependUrl)` once, reuse everywhere.
- Lift `HttpBodyError` / `HttpClientError` into your domain error at the service boundary.
