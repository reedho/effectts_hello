# 06 — Config and ConfigProviders

> Story: [`stories/06-config-and-providers.ts`](../stories/06-config-and-providers.ts)
> Reference: [`tbiz_ts/packages/api-client/src/config.ts`](../../../works/tbiz_ts/packages/api-client/src/config.ts), [`.../example/service_config.ts`](../../../works/tbiz_ts/packages/api-client/src/example/service_config.ts)

## The idea

Hardcoding config values is fine for a prototype. For real apps you want:

- Typed reads with defaults
- Secrets that don't leak into logs
- A way to swap the source (env, test fixture, `import.meta.env`, static object)

Effect's `Config` module handles all three. `ConfigProvider` is the pluggable source.

## Describing your config

Build a typed tree of required values, defaults, and namespaces:

```ts
const DbConfig = Config.nested("DB")(
  Config.all({
    host:     Config.string("HOST").pipe(Config.withDefault("localhost")),
    port:     Config.number("PORT").pipe(Config.withDefault(5432)),
    user:     Config.string("USER").pipe(Config.withDefault("postgres")),
    password: Config.redacted("PASSWORD").pipe(Config.withDefault(Redacted.make("demo"))),
  }),
)
```

- `Config.nested("DB")(...)` scopes child lookups under the `DB` prefix.
- `Config.all({...})` combines multiple configs into a record.
- `Config.withDefault(x)` makes the read optional.
- `Config.redacted(...)` keeps the value out of `toString` output (`"<redacted>"`).

Primitives: `string`, `nonEmptyString`, `number`, `int`, `boolean`, `duration`, `port`, `date`, `url`, `redacted`, `literal`.

### Deriving the type

```ts
type DbConfigType = typeof DbConfig extends Config.Config<infer T> ? T : never
```

In v3 this was `Config.Config.Success<typeof DbConfig>`. That alias doesn't exist in v4 — inline the conditional as above.

## Reading config inside an Effect

```ts
const showDefaults = Effect.gen(function* () {
  const db = yield* DbConfig
  console.log(db.host, db.port, db.user, String(db.password))  // "<redacted>"
})
```

`yield* DbConfig` resolves the config using whichever `ConfigProvider` is currently in scope. By default, Effect reads `process.env`.

## Redacted values

```ts
String(db.password)          // "<redacted>"
Redacted.value(db.password)  // "demo" — explicit unwrap
```

The `Redacted` wrapper hides the value from casual stringification — logging, error messages, JSON.stringify — while still letting authorized code reach the plaintext with `Redacted.value`. Use it for passwords, tokens, client secrets.

## Swapping the source: `ConfigProvider.fromUnknown`

The default provider reads `process.env`. For tests and browsers (where `process.env` is unavailable) you supply values inline:

```ts
const provider = ConfigProvider.fromUnknown({
  DB: {
    HOST: "db.staging.internal",
    PORT: "6543",
    USER: "api",
    PASSWORD: "s3cret",
  },
})

await Effect.runPromise(
  program.pipe(Effect.provide(ConfigProvider.layer(provider))),
)
```

### v4-beta.57 gotcha

`fromUnknown` reads **by literal path segments**. Your `Config.nested("DB")(Config.string("HOST"))` looks up `root.DB.HOST` — so the input needs the *nested* shape above, not flat `{ DB_HOST: "…" }`.

For the flat `DB_HOST` style used by env vars, reach for `ConfigProvider.fromEnv({...})` instead — that splits keys on `_`. Older tbiz_ts code (beta.31) mixed these up because the older fromUnknown was more lenient.

### v3 → v4 rename

```ts
// v3
Layer.provide(Layer.setConfigProvider(provider))

// v4
Layer.provide(ConfigProvider.layer(provider))
```

## Wrapping Config in a Service

Often you want other services to depend on config **as a service**, not as a free-floating `yield*`. Wrap it:

```ts
class DbConfigService extends Context.Service<DbConfigService, DbConfigType>()(
  "app/DbConfig",
) {}

const DbConfigLive = Layer.effect(DbConfigService)(
  Effect.gen(function* () {
    return yield* DbConfig   // resolves through the ambient ConfigProvider
  }),
)

// Useful in React apps where you've already read env at build time:
const makeDbConfigLayer = (cfg: DbConfigType) =>
  Layer.succeed(DbConfigService)(cfg)
```

This is exactly the pattern in `RpcConfigService` ([`rpc-client/src/config.ts`](../../../works/tbiz_ts/packages/rpc-client/src/config.ts)). Browser bundles often can't read env at runtime, so they construct a `makeXxxConfigLayer(staticValues)` at the edge.

## Takeaways

- `Config` describes the **shape** of your required environment.
- `Redacted` keeps secrets out of logs — unwrap with `Redacted.value`.
- `ConfigProvider.fromUnknown` swaps the source for tests; its key form is **literal path segments** (nested object), not env-style `DB_HOST`.
- Wrap Config in a `Context.Service` when downstream services need to depend on it.
