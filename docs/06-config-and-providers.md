# 06 — Config and ConfigProviders

> Story: [`stories/06-config-and-providers.ts`](../stories/06-config-and-providers.ts)
> Reference: [`tbiz_ts/packages/api-client/src/config.ts`](../../../works/tbiz_ts/packages/api-client/src/config.ts)

## The idea

Hardcoding config is fine for a prototype. For real apps you want:

- Typed reads with defaults
- **Schema-validated** primitives (with brands) — one Schema reused for config, HTTP boundaries, forms
- Secrets that don't leak into logs
- A way to swap the source (env, tests, `import.meta.env`, static object)

## `Config.schema` — the recommended path

effect-solutions strongly prefers `Config.schema(Schema, "ENV_NAME")` over `Config.mapOrFail`. You reuse the same Schema for everything:

```ts
const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  Schema.brand("Port"),
)
type Port = typeof Port.Type

const Environment = Schema.Literals(["development", "staging", "production"])
```

- `Schema.NumberFromString` transforms the env-var string into a number.
- Checks enforce "int in [1, 65535]".
- Brand makes it a nominal `Port`, not interchangeable with raw numbers.

Consume it from a Config:

```ts
const port = yield* Config.schema(Port, "PORT")
// port: Port (branded, validated)
```

That same `Port` schema also decodes HTTP query params, validates form input, etc. One source of truth.

## Wrapping Config in a Service

This is the key structural pattern. A Config service has a `layer` (reads from the provider) and a `testLayer` (hardcoded values):

```ts
class AppConfig extends Context.Service<AppConfig, {
  readonly host: string
  readonly port: Port
  readonly env: Environment
  readonly apiKey: Redacted.Redacted
}>()("app/AppConfig") {
  static readonly layer = Layer.effect(AppConfig)(
    Effect.gen(function* () {
      const host   = yield* Config.string("HOST").pipe(Config.withDefault("localhost"))
      const port   = yield* Config.schema(Port, "PORT")
      const env    = yield* Config.schema(Environment, "APP_ENV")
      const apiKey = yield* Config.redacted("API_KEY")
      return { host, port, env, apiKey }
    }),
  )

  static readonly testLayer = Layer.succeed(AppConfig)({
    host: "localhost",
    port: Schema.decodeUnknownSync(Port)("8080"),
    env: "development",
    apiKey: Redacted.make("test-key"),
  })
}
```

Downstream services depend on `AppConfig` — never on `Config` primitives directly.

## Redacted values

```ts
String(cfg.apiKey)          // "<redacted>"
Redacted.value(cfg.apiKey)  // "s3cret" — explicit unwrap
```

`Redacted` hides the value from casual stringification — logs, error messages, accidental `JSON.stringify` — while letting authorized code reach the plaintext. Use it for passwords, API tokens, client secrets.

## Swapping the source: `ConfigProvider`

Default: reads `process.env`. For tests and browsers, supply values inline:

```ts
const provider = ConfigProvider.fromUnknown({
  HOST: "db.staging.internal",
  PORT: "6543",
  APP_ENV: "staging",
  API_KEY: "s3cret",
})

await Effect.runPromise(
  program.pipe(
    Effect.provide(
      AppConfig.layer.pipe(Layer.provide(ConfigProvider.layer(provider))),
    ),
  ),
)
```

### beta.57 gotcha

`fromUnknown` reads by **literal path segments**. `Config.nested("DB")(Config.string("HOST"))` looks up `root.DB.HOST`. So pass a nested object:

```ts
ConfigProvider.fromUnknown({
  DB: { HOST: "localhost", PORT: "5432" }   // ✅
  // not { DB_HOST: "localhost" } — that's the env-style flat form
})
```

For the flat `DB_HOST` style used by env vars, use `ConfigProvider.fromEnv({...})` instead — that splits on `_`.

### v3 → v4 renames

```ts
Layer.setConfigProvider(provider)  // v3
ConfigProvider.layer(provider)     // v4

Config.Config.Success<typeof X>    // v3
T extends Config.Config<infer U> ? U : never   // v4

Config.mapOrFail(predicate)        // still works
Config.schema(Schema, "NAME")      // recommended
```

## Skip the provider in tests — just use `testLayer`

effect-solutions suggests avoiding `ConfigProvider.fromUnknown` in tests entirely. Provide `AppConfig.testLayer` directly — your business code doesn't care that there even *is* a Config module behind the service:

```ts
Effect.runPromise(program.pipe(Effect.provide(AppConfig.testLayer)))
```

Simpler than orchestrating a ConfigProvider, and each test can specialise with its own `Layer.succeed(AppConfig, {...})` inline.

## Takeaways

- Validate + brand with `Config.schema(BrandedSchema, "ENV")` rather than `Config.mapOrFail`.
- Wrap config in a `Context.Service` with `layer` + `testLayer` statics.
- Always `Config.redacted` secrets; unwrap with `Redacted.value`.
- `fromUnknown` → nested object shape; `fromEnv` → flat `SCREAMING_SNAKE`.
- Tests skip ConfigProvider entirely — just provide `AppConfig.testLayer`.
