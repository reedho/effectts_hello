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

## Error renames from v3

| v3 tag to catch          | v4 tag to catch        |
| ------------------------ | ---------------------- |
| `"ResponseError"`        | `"StatusCodeError"` (or `"HttpClientError"`) |
| `"RequestError"`         | `"TransportError"` (or `"HttpClientError"`)   |
| `"ParseError"` (schema)  | `"SchemaError"`        |

`HttpClientError` is a base class that covers both request and response failures, which is why `filterStatusOk` types everything as `HttpClientError`. Match on it when you don't need finer granularity.

`HttpBodyError.reason` also changed — it's now a tagged union (`{ _tag: "JsonError" } | { _tag: "SchemaError", issue }`). Stringify it or narrow by tag.

## Two small gotchas

1. **`bodyJson` returns an Effect.** Yield it first, or use `bodyJsonUnsafe` if you're sure the body is serializable.
2. **`HttpClient.make(fn)` validates the URL.** Even for mocks (chapter 9) you need an absolute URL — `"http://mock.local/rpc"` not `"/rpc"`.

## Schema decode of the response body

The v4 migration note: `HttpClientResponse.schemaBodyJson(schema)(response)` was removed because its constraints can't be satisfied for generic schemas. Do the decode manually:

```ts
const json = yield* response.json
const data = Schema.decodeUnknownSync(Response as any)(json) as Schema.Schema.Type<typeof Response>
```

`qilin/common.ts` uses this exact pattern. The `as any` is unfortunate but pragmatic.

## Takeaways

- Everything lives under `effect/unstable/http` now.
- Build requests with `HttpClientRequest.*`, then `yield*` the body-adding step.
- Decorate the client with `filterStatusOk` + `mapRequest(prependUrl)` once, reuse everywhere.
- Lift `HttpBodyError` / `HttpClientError` into your domain error at the service boundary.
