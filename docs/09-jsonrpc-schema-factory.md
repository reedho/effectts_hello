# 09 — Generic schema factories + mocked HttpClient

> Story: [`stories/09-jsonrpc-schema-factory.ts`](../stories/09-jsonrpc-schema-factory.ts)
> Reference: [`tbiz_ts/packages/rpc-client/src/schemas/jsonrpc.ts`](../../../works/tbiz_ts/packages/rpc-client/src/schemas/jsonrpc.ts), [`.../client.ts`](../../../works/tbiz_ts/packages/rpc-client/src/client.ts)

Two patterns in one chapter. They show up together so often it makes sense to teach them together.

## Pattern 1: Schema factories

JSON-RPC wraps every response in the same envelope:

```json
{ "jsonrpc": "2.0", "id": 1, "result": { ...method-specific payload... } }
```

Writing a new Struct for every method is grim. Instead, parameterize the envelope by the result schema:

```ts
const JsonRpcSuccess = <Result extends Schema.Top>(result: Result) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    result,
    id: JsonRpcId,
  })

const JsonRpcError = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  error: Schema.Struct({ code: Schema.Number, message: Schema.String, data: Schema.optional(Schema.Unknown) }),
  id: Schema.Union([JsonRpcId, Schema.Null]),
})

const JsonRpcResponse = <R extends Schema.Top>(r: R) =>
  Schema.Union([JsonRpcSuccess(r), JsonRpcError])
```

Now every method gets its envelope for free:

```ts
const GetUserEnvelope   = JsonRpcResponse(GetUserResult)
const ListOrdersEnv     = JsonRpcResponse(ListOrdersResult)
const CancelBookingEnv  = JsonRpcResponse(CancelBookingResult)
```

The same pattern works for REST envelopes like `{ data: T, meta: ... }`, paginated responses, gRPC wrappers — anywhere the outer shape is fixed and the inner shape varies.

### `Schema.Top`?

`Schema.Top` is v4's "any schema" upper bound — the thing you constrain generic parameters with. It replaced v3's `Schema.Schema.Any`.

### The `as any` on decode

```ts
Schema.decodeUnknownSync(JsonRpcResponse(result) as any)(json)
```

When you plug a generic-parameterized schema into `decodeUnknownSync`, TypeScript can't prove that the generic's `DecodingServices` type parameter resolves to `never`. The `as any` is safe because the decoder ignores that parameter at runtime, and it's exactly what `qilin/common.ts` and `pegasus.ts` do.

## Pattern 2: Mocked `HttpClient` Layer

Your service depends on `HttpClient.HttpClient` (from chapter 7). In tests, you don't want the network — you want a deterministic response keyed to the request. `HttpClient.make(fn)` builds a client from a request-to-response function:

```ts
const MockHttpLayer = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request) => {
    // inspect request.url / request.method / request.body if you want per-call behavior
    return Effect.succeed(makeMockResponse({
      jsonrpc: "2.0",
      id: 1,
      result: { id: "u1", name: "Ridho", role: "admin" },
    }))
  }),
)
```

The `makeMockResponse` helper builds the minimal subset of `HttpClientResponse` your code reaches for (mostly `.json`, `.status`, `.headers`, `.text`).

### Test against it

```ts
const program = rpcCall("users.get", { id: "u1" }, GetUserResult)

const result = await Effect.runPromise(
  program.pipe(Effect.provide(MockHttpLayer)),
)
// deterministic — no network
```

Swap in an "error" mock to test the sad path:

```ts
const ErrorHttpLayer = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make(() =>
    Effect.succeed(makeMockResponse({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32601, message: "Method not found" },
    })),
  ),
)
```

### URL gotcha

`HttpClient.make(fn)` validates the outgoing request's URL **before** calling your mock function. Even a mock needs an absolute URL — `"http://mock.local/rpc"` works; `"/rpc"` throws a parser error.

## Putting the patterns together

Your RPC service stays clean:

```ts
const rpcCall = <R extends Schema.Top>(
  method: string,
  params: unknown,
  result: R,
) =>
  Effect.gen(function* () {
    // ... build request, execute, parse body ...
    const envelope = Schema.decodeUnknownSync(JsonRpcResponse(result) as any)(json)
    // narrow on "error" / "result"
  })
```

Production wires `FetchHttpClient.layer`. Tests wire `MockHttpLayer`. The service code is identical in both.

## Takeaways

- Envelope + payload? Make it a **schema factory** on `<R extends Schema.Top>`.
- Mock `HttpClient` via `HttpClient.make(fn)` — no MSW, no Nock, no local server.
- Remember `Schema.Top` (not `Schema.Schema.Any`) and use absolute URLs in mocks.
