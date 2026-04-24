/**
 * 06 — Config, Redacted, Schema-validated config.
 *
 * effect-solutions recommends:
 *   - Wrap config reads in a service with `static readonly layer` + `testLayer`.
 *   - Use `Config.schema(BrandedSchema, "ENV_VAR")` for validation — not
 *     `Config.mapOrFail`. You get Schema's full validation + branding.
 *   - Use `Redacted` for every secret.
 *
 * Run: `bun stories/06-config-and-providers.ts`
 */

import { Config, ConfigProvider, Context, Effect, Layer, Redacted, Schema } from "effect";

/* ---------- 1. Validate + brand config values with Config.schema --------- *
 * `Schema.NumberFromString` decodes the env-var string into a number.
 * Check it's an int in [1, 65535]. Brand it as `Port`. One schema,
 * reused for runtime validation elsewhere.
 */

const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  Schema.brand("Port"),
);
type Port = typeof Port.Type;

const Environment = Schema.Literals(["development", "staging", "production"]);
type Environment = typeof Environment.Type;

/* ---------- 2. A Config service with layer + testLayer ------------------ */

interface AppConfigShape {
  readonly host: string;
  readonly port: Port;
  readonly env: Environment;
  readonly apiKey: Redacted.Redacted;
}

class AppConfig extends Context.Service<AppConfig, AppConfigShape>()("app/AppConfig") {
  // Production: read + validate from the ConfigProvider (env by default)
  static readonly layer = Layer.effect(AppConfig)(
    Effect.gen(function* () {
      const host = yield* Config.string("HOST").pipe(Config.withDefault("localhost"));
      const port = yield* Config.schema(Port, "PORT");
      const env = yield* Config.schema(Environment, "APP_ENV");
      const apiKey = yield* Config.redacted("API_KEY");
      return { host, port, env, apiKey };
    }),
  );

  // Tests / static contexts — hardcoded values, no ConfigProvider needed
  static readonly testLayer = Layer.succeed(AppConfig)({
    host: "localhost",
    port: Schema.decodeUnknownSync(Port)("8080"),
    env: "development",
    apiKey: Redacted.make("test-key"),
  });
}

/* ---------- 3. A ConfigProvider that feeds the service ------------------ *
 * `ConfigProvider.fromUnknown` reads by literal path. `Config.nested` /
 * `Config.redacted("X")` look up `root.X`.
 */

const provider = ConfigProvider.fromUnknown({
  HOST: "db.staging.internal",
  PORT: "6543",
  APP_ENV: "staging",
  API_KEY: "s3cret",
});

const program = Effect.fn("showConfig")(function* () {
  const cfg = yield* AppConfig;
  console.log("1) from provider:", {
    host: cfg.host,
    port: cfg.port,        // branded number
    env: cfg.env,          // literal-narrowed
    apiKey: String(cfg.apiKey),       // "<redacted>"
    apiKeyValue: Redacted.value(cfg.apiKey),
  });
});

await Effect.runPromise(
  program().pipe(
    Effect.provide(
      // Stack: AppConfig.layer (reads from provider) ← ConfigProvider.layer(provider)
      AppConfig.layer.pipe(Layer.provide(ConfigProvider.layer(provider))),
    ),
  ),
);

/* ---------- 4. Same program, test values ---------------------------------- *
 * No ConfigProvider involved — the testLayer short-circuits the whole
 * config-reading machinery.
 */

await Effect.runPromise(program().pipe(Effect.provide(AppConfig.testLayer)));

/* ---------- 5. Schema-validated primitives you'll reuse ------------------ *
 * Because Port is just a Schema, you can reuse the *same* definition at:
 *   - config time (Config.schema)
 *   - HTTP boundary (decodeUnknownExit(Port)(input))
 *   - form validation
 *   - domain types (Port is a brand)
 */

// Decode a raw HTTP query param into a Port the same way:
const fromQuery = Schema.decodeUnknownSync(Port)("443");
console.log("5) reused Port schema:", fromQuery);

/* ---------- v3 → v4 cheat -------------------------------------------------
 *   ConfigProvider.fromMap(map)    → ConfigProvider.fromUnknown(obj)
 *   Layer.setConfigProvider(cp)    → ConfigProvider.layer(cp)
 *   Config.Config.Success<typeof X>
 *     → `T extends Config.Config<infer U> ? U : never`
 *   Config.mapOrFail(predicate)    → Config.schema(Schema, "NAME") (preferred)
 *   Config.unwrap returns Config   → yield* MyConfig inside Effect.gen +
 *                                     wrap in Layer.effect.
 */
