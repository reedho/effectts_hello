/**
 * 09 — Generic Schema factories + mocked HttpClient layer.
 *
 * Problem: JSON-RPC / gRPC-like APIs wrap every result in the same
 * envelope shape — `{ jsonrpc, id, result: T }`. You don't want to
 * write a new Struct for every method.
 *
 * Solution: a **Schema factory** — a function taking a `Schema.Top` and
 * returning a Struct parameterized by it. This is what
 * `tbiz_ts/packages/rpc-client/src/schemas/jsonrpc.ts` does.
 *
 * We also show how to *mock* the HttpClient layer for testing, without
 * spinning up a real server. Powerful pattern.
 *
 * Run: `bun stories/09-jsonrpc-schema-factory.ts`
 */

import { Data, Effect, Layer, pipe, Schema } from "effect";
import type { HttpClientResponse } from "effect/unstable/http";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

/* ---------- 1. Envelope factories ---------------------------------------- *
 * `Schema.Top` is v4's "any schema" upper bound (was `Schema.Schema.Any`).
 */

const JsonRpcId = Schema.Union([Schema.String, Schema.Number]);

const JsonRpcSuccess = <Result extends Schema.Top>(result: Result) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    result,
    id: JsonRpcId,
  });

const JsonRpcError = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  error: Schema.Struct({
    code: Schema.Number,
    message: Schema.String,
    data: Schema.optional(Schema.Unknown),
  }),
  id: Schema.Union([JsonRpcId, Schema.Null]),
});

const JsonRpcResponse = <R extends Schema.Top>(r: R) =>
  Schema.Union([JsonRpcSuccess(r), JsonRpcError]);

/* ---------- 2. Use the factory with concrete method schemas -------------- */

const GetUserResult = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.Literals(["admin", "user", "viewer"]),
});

const GetUserEnvelope = JsonRpcResponse(GetUserResult);

/* ---------- 3. Domain error + RPC client --------------------------------- */

class RpcError extends Data.TaggedError("RpcError")<{
  readonly code: number;
  readonly message: string;
}> {}

class ParseError extends Data.TaggedError("ParseError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

let nextId = 0;

const rpcCall = <R extends Schema.Top>(method: string, params: unknown, result: R) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const id = ++nextId;

    // `HttpClient.make` validates the URL up-front, so even a mock client
    // needs an absolute URL. Real code would build this off a config baseUrl.
    const req = yield* HttpClientRequest.post("http://mock.local/rpc").pipe(
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.bodyJson({ jsonrpc: "2.0", method, params, id }),
    );
    const resp = yield* client.execute(req);
    const json = yield* resp.json;

    // The `as any` on the schema mirrors the pattern in
    // `tbiz_ts/packages/api-client/src/qilin/common.ts` — generic factory
    // schemas carry a `DecodingServices` type parameter that the sync
    // decoder can't statically reconcile. The cast is safe here.
    type Envelope =
      | { jsonrpc: "2.0"; result: Schema.Schema.Type<R>; id: string | number }
      | { jsonrpc: "2.0"; error: { code: number; message: string }; id: unknown };

    const envelope = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(JsonRpcResponse(result) as any)(json) as Envelope,
      catch: (e) => new ParseError({ message: "bad envelope", cause: e }),
    });

    if ("error" in envelope) {
      return yield* Effect.fail(
        new RpcError({ code: envelope.error.code, message: envelope.error.message }),
      );
    }
    return envelope.result;
  }).pipe(
    Effect.catchTag("HttpBodyError", (e) =>
      Effect.fail(new ParseError({ message: "bad body", cause: e })),
    ),
    Effect.catchTag("HttpClientError", (e) =>
      Effect.fail(new ParseError({ message: e.message, cause: e })),
    ),
  );

/* ---------- 4. A mock HttpClient.Layer ------------------------------------ *
 * The trick: `HttpClient.make(fn)` builds an HttpClient from a request→response
 * function. Perfect for unit tests — no network, fully deterministic.
 */

const makeMockResponse = (body: unknown): HttpClientResponse.HttpClientResponse => {
  // Minimal `HttpClientResponse` shape we need for this example
  const headers = new Headers({ "content-type": "application/json" });
  return {
    status: 200,
    headers,
    json: Effect.succeed(body),
    text: Effect.succeed(JSON.stringify(body)),
  } as unknown as HttpClientResponse.HttpClientResponse;
};

const MockHttpLayer = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make((request) => {
    // Look at the outgoing request to choose a canned response
    const url = request.url;
    // (we ignore url here — the fake always returns a user envelope)
    void url;
    return Effect.succeed(
      makeMockResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { id: "u1", name: "Ridho", role: "admin" },
      }),
    );
  }),
);

/* ---------- 5. Run against the mock -------------------------------------- */

const program = rpcCall("users.get", { id: "u1" }, GetUserResult);

const result = await Effect.runPromise(program.pipe(Effect.provide(MockHttpLayer)));
console.log("5) mocked rpc result:", result);

/* ---------- 6. A mock that returns an RPC error -------------------------- */

const ErrorHttpLayer = Layer.succeed(HttpClient.HttpClient)(
  HttpClient.make(() =>
    Effect.succeed(
      makeMockResponse({
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32601, message: "Method not found" },
      }),
    ),
  ),
);

const errOutput = await Effect.runPromise(
  pipe(
    rpcCall("users.get", { id: "u1" }, GetUserResult),
    Effect.provide(ErrorHttpLayer),
    Effect.match({
      onSuccess: () => "unexpected success",
      onFailure: (e) =>
        e._tag === "RpcError" ? `rpc ${e.code}: ${e.message}` : `parse: ${e.message}`,
    }),
  ),
);
console.log("6) mocked rpc error:", errOutput);

/* ---------- Takeaways ----------------------------------------------------- *
 *   Schema factories let you parameterize envelope shapes generically.
 *   `Schema.Top` is the v4 "any schema" bound.
 *   `HttpClient.make(fn)` gives you a mock client in one line — great for
 *   tests of effects that depend on HttpClient.
 */
