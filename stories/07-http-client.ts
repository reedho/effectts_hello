/**
 * 07 — HTTP client (effect/unstable/http).
 *
 * Effect v4 rolls the HTTP client into core under `effect/unstable/http`.
 * No more `@effect/platform` / `@effect/platform-browser`.
 *
 * This story spins up a throwaway Bun.serve so you can run it offline.
 *
 * Real-world: `packages/api-client/src/qilin/common.ts`, `.../pegasus.ts`
 * Run: `bun stories/07-http-client.ts`
 */

import { Data, Effect, pipe, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";

/* ---------- 0. A local server so the story is offline-friendly ------------ */

const server = Bun.serve({
  port: 0, // ephemeral
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/echo" && req.method === "POST") {
      const body = await req.json();
      return Response.json({ ok: true, echoed: body });
    }
    if (url.pathname === "/boom") {
      return new Response("nope", { status: 500 });
    }
    return new Response("not found", { status: 404 });
  },
});
const BASE = `http://localhost:${server.port}`;
console.log(`0) fake server on ${BASE}`);

/* ---------- 1. Typed errors + response schema ---------------------------- */

class ApiError extends Data.TaggedError("ApiError")<{
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

const EchoResponse = Schema.Struct({
  ok: Schema.Boolean,
  echoed: Schema.Record(Schema.String, Schema.Unknown),
});

/* ---------- 2. POST with JSON body, status filter, schema decode --------- *
 * The core recipe, distilled from tbiz_ts pegasus.ts / qilin/common.ts:
 *
 *   1) `HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJson(body))`
 *   2) `client.pipe(HttpClient.filterStatusOk)` — turns non-2xx into an error
 *   3) `client.execute(req)` → response
 *   4) `response.json` → unknown
 *   5) `Schema.decodeUnknownSync(schema)(json)` → typed
 *   6) `Effect.catchTag("HttpClientError", ...)` / `HttpBodyError` → your domain error
 */

const echoSomething = (payload: { greet: string }) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const okClient = client.pipe(HttpClient.filterStatusOk);

    // `bodyJson` returns Effect<HttpClientRequest, HttpBodyError> — yield it
    // to get the plain request. (`bodyJsonUnsafe` returns the request directly
    // but throws if not serializable.)
    const req = yield* HttpClientRequest.post(`${BASE}/echo`).pipe(
      HttpClientRequest.bodyJson(payload),
    );

    const response = yield* okClient.execute(req);
    const json = yield* response.json;
    return Schema.decodeUnknownSync(EchoResponse)(json);
  }).pipe(
    Effect.catchTag("HttpBodyError", (e) =>
      Effect.fail(new ApiError({ code: "EREQ", message: JSON.stringify(e.reason), cause: e })),
    ),
    Effect.catchTag("HttpClientError", (e) =>
      Effect.fail(new ApiError({ code: "ERESP", message: e.message, cause: e })),
    ),
  );

const echoProgram = echoSomething({ greet: "hi" }).pipe(
  Effect.provide(FetchHttpClient.layer),
);

const echoed = await Effect.runPromise(echoProgram);
console.log("2) echoed:", echoed);

/* ---------- 3. Mapping a 500 into our domain error ----------------------- */

const hitBoom = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const okClient = client.pipe(HttpClient.filterStatusOk);
  const resp = yield* okClient.execute(HttpClientRequest.get(`${BASE}/boom`));
  return yield* resp.json;
}).pipe(
  Effect.catchTag("HttpClientError", (e) =>
    Effect.fail(new ApiError({ code: "ERESP", message: e.message, cause: e })),
  ),
  Effect.provide(FetchHttpClient.layer),
);

const boomResult = await Effect.runPromise(
  pipe(
    hitBoom,
    Effect.match({
      onFailure: (e) => `domain error: ${e.code} — ${e.message.slice(0, 60)}`,
      onSuccess: (x) => `succeeded: ${JSON.stringify(x)}`,
    }),
  ),
);
console.log("3)", boomResult);

/* ---------- 4. Shaping a client with mapRequest -------------------------- *
 * `HttpClient.mapRequest(HttpClientRequest.prependUrl(baseUrl))` is the
 * "make every request prefix-aware" trick used in qilin/pegasus clients.
 */

const apiClient = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  return client.pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(BASE)),
    HttpClient.filterStatusOk,
  );
});

const call = Effect.gen(function* () {
  const client = yield* apiClient;
  const req = yield* HttpClientRequest.post("/echo").pipe(
    HttpClientRequest.bodyJson({ via: "prefixed client" }),
  );
  const resp = yield* client.execute(req);
  return yield* resp.json;
}).pipe(Effect.provide(FetchHttpClient.layer));

console.log("4) via prefixed client:", await Effect.runPromise(call));

/* ---------- teardown ------------------------------------------------------ */

server.stop();
