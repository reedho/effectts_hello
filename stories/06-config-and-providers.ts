/**
 * 06 — Config, Redacted, ConfigProvider.
 *
 * `Config` is Effect's typed environment-config reader. You describe the
 * shape you want; Effect pulls values from a ConfigProvider (by default:
 * process.env).
 *
 * Real-world: `packages/api-client/src/config.ts` (QilinConfig, PegasusConfig)
 *             `packages/api-client/src/example/service_config.ts`
 *
 * Run: `bun stories/06-config-and-providers.ts`
 */

import { Config, ConfigProvider, Context, Effect, Layer, Redacted } from "effect";

/* ---------- 1. A nested config tree with defaults ------------------------ *
 * Mirrors the tbiz_ts QilinConfig shape.
 */

const DbConfig = Config.nested("DB")(
  Config.all({
    host: Config.string("HOST").pipe(Config.withDefault("localhost")),
    port: Config.number("PORT").pipe(Config.withDefault(5432)),
    user: Config.string("USER").pipe(Config.withDefault("postgres")),
    // Redacted hides the value in logs (toString returns "<redacted>")
    password: Config.redacted("PASSWORD").pipe(Config.withDefault(Redacted.make("demo"))),
  }),
);

// Derive the TypeScript type from the Config (v4 pattern — no Config.Config.Success)
type DbConfigType = typeof DbConfig extends Config.Config<infer T> ? T : never;

/* ---------- 2. Use Config inside an Effect (from default env) ----------- */

const showDefaults = Effect.gen(function* () {
  const db = yield* DbConfig;
  console.log("1) defaults:", {
    host: db.host,
    port: db.port,
    user: db.user,
    password: String(db.password), // "<redacted>"
    // Explicit unwrap:
    passwordUnsafe: Redacted.value(db.password),
  });
});

await Effect.runPromise(showDefaults);

/* ---------- 3. Override config with ConfigProvider.fromUnknown ----------- *
 * Great for tests and for browsers where process.env is unavailable. The
 * b2c-studio browser pattern uses this with `import.meta.env.VITE_*`.
 */

// In v4-beta.57, `fromUnknown` reads the object by literal path segments:
// `Config.nested("DB")(Config.string("HOST"))` looks up root.DB.HOST.
// If you instead want the env-var-style flat form (DB_HOST, DB_PORT),
// reach for `ConfigProvider.fromEnv({...})` which splits on `_`.
const overrideProvider = ConfigProvider.fromUnknown({
  DB: {
    HOST: "db.staging.internal",
    PORT: "6543",
    USER: "api",
    PASSWORD: "s3cret",
  },
});

const showFromProvider = Effect.gen(function* () {
  const db = yield* DbConfig;
  console.log("2) overridden:", {
    host: db.host,
    port: db.port,
    user: db.user,
    password: String(db.password),
  });
});

await Effect.runPromise(
  showFromProvider.pipe(Effect.provide(ConfigProvider.layer(overrideProvider))),
);

/* ---------- 4. Wrap Config in a Service ---------------------------------- *
 * This is the pattern you'll see in qilin/common.ts and rpc-client/config.ts.
 * It lets other services depend on the config as a first-class Service.
 */

class DbConfigService extends Context.Service<DbConfigService, DbConfigType>()(
  "app/DbConfig",
) {}

const DbConfigLive = Layer.effect(DbConfigService)(
  Effect.gen(function* () {
    return yield* DbConfig;
  }),
);

// A static-value variant — useful for React apps that already have env
const makeDbConfigLayer = (cfg: DbConfigType) => Layer.succeed(DbConfigService)(cfg);

const useCfg = Effect.gen(function* () {
  const cfg = yield* DbConfigService;
  console.log("4) via service:", `${cfg.host}:${cfg.port} as ${cfg.user}`);
});

await Effect.runPromise(
  useCfg.pipe(
    Effect.provide(DbConfigLive),
    Effect.provide(ConfigProvider.layer(overrideProvider)),
  ),
);

await Effect.runPromise(
  useCfg.pipe(
    Effect.provide(
      makeDbConfigLayer({
        host: "static",
        port: 1111,
        user: "static-user",
        password: Redacted.make("xxx"),
      }),
    ),
  ),
);

/* ---------- v3 → v4 cheat -------------------------------------------------
 *   ConfigProvider.fromMap(map)    → ConfigProvider.fromUnknown(obj)
 *   Layer.setConfigProvider(cp)    → ConfigProvider.layer(cp)
 *   Config.Config.Success<typeof X>
 *     → `T extends Config.Config<infer U> ? U : never`
 *   Config.unwrap returns Config, not Effect — use `yield* MyConfig` inside
 *   an Effect.gen wrapped in Layer.effect.
 */
