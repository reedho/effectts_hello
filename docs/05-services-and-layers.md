# 05 — Services and Layers

> Story: [`stories/05-services-and-layers.ts`](../stories/05-services-and-layers.ts)
> Reference: [`tbiz_ts/packages/auth/src/auth.ts`](../../../works/tbiz_ts/packages/auth/src/auth.ts), [`.../api-client/src/qilin.ts`](../../../works/tbiz_ts/packages/api-client/src/qilin.ts)

## Vocabulary

- **Service** — a typed dependency slot. "I need a thing of shape `X`."
- **Layer** — a recipe for building and wiring services. "Here's how to construct an `X`."
- **`R` in `Effect<A, E, R>`** — the set of services this Effect requires.

You can write programs without ever touching a real implementation. Providing the Layer at the edge is what makes it executable.

## Declaring a service

```ts
interface GreeterShape {
  readonly greet: (name: string) => Effect.Effect<string>
}

class Greeter extends Context.Service<Greeter, GreeterShape>()("app/Greeter") {}
```

**Naming convention** (from tbiz_ts): the shape interface and the class can't share the same name. Suffix the shape with `Shape` (or call it `AuthServiceShape`, `RpcClientService`, whatever — just be consistent).

### Version note

The `tbiz_ts` code uses `ServiceMap.Service<Self, Shape>()("id")`. In effect-beta.57 the module was renamed to `Context`. The pattern is identical:

```ts
// beta.31 (tbiz_ts)
import { ServiceMap } from "effect"
class X extends ServiceMap.Service<X, XShape>()("id") {}

// beta.57 (this project)
import { Context } from "effect"
class X extends Context.Service<X, XShape>()("id") {}
```

## Providing an implementation

Two constructors — both **curried**:

```ts
const GreeterLive = Layer.succeed(Greeter)({
  greet: (name) => Effect.succeed(`Hello, ${name}!`),
})
```

If the implementation itself needs Effects (e.g., it reads config, other services, or does I/O during construction), use `Layer.effect`:

```ts
const LoggerLive = Layer.effect(Logger)(
  Effect.gen(function* () {
    const clock = yield* Clock   // Logger depends on Clock
    return {
      info: (msg) => Effect.gen(function* () {
        const t = yield* clock.now()
        console.log(`[${t}] ${msg}`)
      }),
    }
  }),
)
```

### The #1 v3 → v4 trap

The curried form. If you write `Layer.effect(Tag, effect)` (v3), TypeScript will complain loudly:

```ts
Layer.effect(MyService, Effect.gen(...))      // ❌ v3
Layer.effect(MyService)(Effect.gen(...))      // ✅ v4
Layer.succeed(MyService, impl)                 // ❌ v3
Layer.succeed(MyService)(impl)                 // ✅ v4
```

## Consuming a service

Inside `Effect.gen`, `yield* Tag` hands you the service instance:

```ts
const program = Effect.gen(function* () {
  const greeter = yield* Greeter
  const msg = yield* greeter.greet("Ridho")
  return msg
})
```

Services are **not** Effects. You can't `pipe(Greeter, Effect.flatMap(...))`. Always through `yield*`.

## Wiring layers

- `Layer.merge(A, B)` — combined Layer that provides both services (peers).
- `Layer.provide(X, Y)` — Y's dependencies are satisfied by X.
- `Layer.mergeAll(A, B, C)` — merge many.

The dependency graph pattern:

```ts
const AppLive = LoggerLive.pipe(
  Layer.provide(ClockLive),      // Logger needed Clock; hand it over
)

await Effect.runPromise(
  program.pipe(Effect.provide(AppLive)),
)
```

Once `Effect.provide` satisfies all services, the `R` parameter reaches `never` and the Effect is runnable at the top level.

## Multi-variant Layers

A convention from tbiz_ts: attach alternate Layers as static fields on the class. Callers pick whichever the environment calls for:

```ts
class Mailer extends Context.Service<Mailer, MailerShape>()("app/Mailer") {
  static Live = Layer.succeed(Mailer)({
    send: (to, body) => Effect.succeed(`[PROD] emailed ${to}`),
  })

  static Mock = Layer.succeed(Mailer)({
    send: (to, body) => Effect.succeed(`[MOCK] would email ${to}`),
  })
}

// In production code
program.pipe(Effect.provide(Mailer.Live))

// In tests
program.pipe(Effect.provide(Mailer.Mock))
```

`QilinServiceImpl.Default` and `PegasusServiceImpl.Live` in tbiz_ts follow this pattern exactly.

## Takeaways

- `Context.Service<Self, Shape>()("id")` declares the slot.
- `Layer.succeed(Tag)(impl)` and `Layer.effect(Tag)(effect)` fill it. **Curried!**
- `yield* Tag` inside `Effect.gen` consumes the service.
- `Layer.provide` / `Layer.merge` compose the graph.
- Use static `Live` / `Mock` Layer fields as the test swap.
