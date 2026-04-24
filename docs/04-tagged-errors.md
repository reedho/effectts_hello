# 04 — Tagged errors and defects

> Story: [`stories/04-tagged-errors.ts`](../stories/04-tagged-errors.ts)
> Reference: [`tbiz_ts/packages/api-client/src/error.ts`](../../../works/tbiz_ts/packages/api-client/src/error.ts), [`.../rpc-client/src/errors.ts`](../../../works/tbiz_ts/packages/rpc-client/src/errors.ts)

effect-solutions puts `Schema.TaggedErrorClass` front and center. It's the recommended way to model domain errors — and unlike `Data.TaggedError`, the resulting class is Schema-integrated (serializable, decodable, and composable with other schemas).

## `Schema.TaggedErrorClass` — the recommended form

```ts
class ApiError extends Schema.TaggedErrorClass<ApiError>()("ApiError", {
  code: Schema.String,
  message: Schema.String,
  status: Schema.optional(Schema.Number),
}) {}

class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  code: Schema.Literals(["TOKEN_EXPIRED", "TOKEN_INVALID", "UNAUTHORIZED"]),
}) {}
```

Each class is:

- a schema (you can decode it, stringify it, serialize it, send it over the wire)
- a constructor (`new ApiError({ ... })`)
- a **yieldable Effect** — no `Effect.fail` wrapper needed
- tagged with `_tag` for exhaustive pattern matching

## Yieldable — skip `Effect.fail`

This is the biggest ergonomic win. You don't wrap:

```ts
// ✅ The effect-solutions idiom
return Effect.gen(function* () {
  if (!id) yield* new ApiError({ code: "EBAD", message: "id is required" })
  // ...
})

// ❌ Works, but unnecessary noise — the language-service flags this
yield* Effect.fail(new ApiError({ ... }))
```

Our storybook earlier used the wrapped form; the language-service diagnostic `unnecessaryFailYieldableError` pointed it out. We switched. You should too.

## Recover with `catchTag` / `catchTags`

```ts
const recovered = pipe(
  fetchUser(id),
  Effect.catchTag("AuthError", (e) =>
    // e is narrowed to AuthError
    Effect.succeed({ id: "guest", name: `fallback (${e.code})` }),
  ),
)
```

For several tags at once, `Effect.catchTags({ Tag: handler, ... })`. If you handle every tag in the error union, the remaining error channel is `never`.

## `Schema.Defect` — wrapping foreign errors

When you call fetch / axios / firebase / any non-Effect library, the "error" value could be anything. `Schema.Defect` stores it losslessly AND keeps the result serializable:

```ts
class NetworkError extends Schema.TaggedErrorClass<NetworkError>()("NetworkError", {
  message: Schema.String,
  cause: Schema.Defect,   // safely holds anything — Error, unknown, whatever
}) {}

const fetchSomething = (url: string) =>
  Effect.tryPromise({
    try: () => fetch(url).then(r => r.json()),
    catch: (error) => new NetworkError({ message: `fetch ${url}`, cause: error }),
  })
```

Why not just `unknown`? Because you can serialize a `NetworkError` to JSON (to ship to a logging service, or persist in a DB), and `Schema.Defect` turns the inner Error/object into something round-trippable. `unknown` breaks on `JSON.stringify`.

## Typed errors vs. defects

effect-solutions draws a hard line:

- **Typed errors** — things the caller can sensibly handle: 404, auth, validation, rate limits. Tracked in the `E` channel of `Effect<A, E, R>`.
- **Defects** — unrecoverable: bugs, invariant violations, "the config wasn't there at startup." Not in `E`. They terminate the fiber and propagate until caught at the system edge (logger, crash reporter).

### `Effect.orDie` — convert typed error → defect

Use it where recovery is meaningless:

```ts
const main = Effect.gen(function* () {
  const cfg = yield* loadConfig.pipe(Effect.orDie)   // if config fails: die
  yield* app(cfg)
})
```

Now `loadConfig`'s typed error disappears from the `E` channel. If it ever fails, the fiber dies — which is the right thing at startup. No one can write `Effect.catchTag("ConfigError", ...)` in business code and accidentally silence a fatal.

### `Effect.catchDefect` — only at the edge

Almost never. Only for top-level logging/diagnostics or plugin sandboxing:

```ts
const logged = pipe(
  someProgram,
  Effect.catchDefect((defect) =>
    Effect.sync(() => {
      log.fatal(defect)
      return "recovered-for-logging"
    }),
  ),
)
```

By the time you're catching a defect, the program is already in a bad state. Catching just gives you a chance to report it before shutdown.

## Legacy: `Data.TaggedError`

Still supported. Still all over `tbiz_ts`. Structurally similar, but **not Schema-integrated** — no validation, no serialization. Fine for simple cases; prefer `Schema.TaggedErrorClass` in new code.

```ts
class LegacyError extends Data.TaggedError("LegacyError")<{
  readonly message: string
}> {}
```

## Takeaways

- `Schema.TaggedErrorClass<Self>()("Tag", {fields})` — preferred error shape.
- Yield it directly: `yield* new Err(...)`. No `Effect.fail`.
- `Schema.Defect` for wrapping foreign errors inside your tagged errors.
- Typed errors = recoverable. Defects = unrecoverable. Don't blur the line.
- `Effect.orDie` to promote a typed error to a defect at boundaries.
