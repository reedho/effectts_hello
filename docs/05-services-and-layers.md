# 05 — Services and Layers

> Story: [`stories/05-services-and-layers.ts`](../stories/05-services-and-layers.ts)
> Reference: [`tbiz_ts/packages/auth/src/auth.ts`](../../../works/tbiz_ts/packages/auth/src/auth.ts), [`.../api-client/src/qilin.ts`](../../../works/tbiz_ts/packages/api-client/src/qilin.ts)

## Vocabulary

- **Service** — a typed dependency slot.
- **Layer** — a recipe for building and wiring services.
- **`R` in `Effect<A, E, R>`** — the set of services this Effect requires.

## Declaring a service

```ts
interface GreeterShape {
  readonly greet: (name: string) => Effect.Effect<string>
}

class Greeter extends Context.Service<Greeter, GreeterShape>()("app/Greeter") {}
```

### Convention: class + shape interface

Shape and class can't share a name. Suffix with `Shape` (or `ServiceShape`). This is the tbiz_ts convention.

### Version note

effect-solutions still documents `ServiceMap.Service`. In **effect-beta.57** that module was renamed to `Context`. Identical API:

```ts
// beta.31 (tbiz_ts, effect-solutions docs)
import { ServiceMap } from "effect"
class X extends ServiceMap.Service<X, XShape>()("id") {}

// beta.57 (this project)
import { Context } from "effect"
class X extends Context.Service<X, XShape>()("id") {}
```

## Providing implementations — `layer` / `testLayer`

The effect-solutions naming convention: attach the layers as **static** class properties, named **`layer`** (production) and **`testLayer`** (lightweight test impl):

```ts
class GreeterImpl {
  static readonly layer = Layer.effect(Greeter)(
    Effect.gen(function* () {
      const greet = Effect.fn("Greeter.greet")(function* (name: string) {
        return `Hello, ${name}!`
      })
      return { greet }
    }),
  )

  static readonly testLayer = Layer.succeed(Greeter)({
    greet: (name) => Effect.succeed(`[test] hi ${name}`),
  })
}
```

Notice the service method is wrapped in `Effect.fn("Greeter.greet")(...)`. Every method that returns an Effect gets a call-site trace and a telemetry span for free.

### The #1 v3 → v4 trap: curried Layer constructors

```ts
Layer.effect(MyService, effect)       // ❌ v3
Layer.effect(MyService)(effect)       // ✅ v4
Layer.succeed(MyService, impl)        // ❌ v3
Layer.succeed(MyService)(impl)        // ✅ v4
```

## Consuming a service

Inside `Effect.gen`, `yield* Tag` hands you the service. Services are **not** Effects — you can't `pipe(Tag, Effect.flatMap(...))`.

```ts
const program = Effect.fn("program")(function* () {
  const greeter = yield* Greeter
  return yield* greeter.greet("Ridho")
})
```

## Wiring the graph

- `Layer.mergeAll(A, B, C)` / `Layer.merge(A, B)` — peers offered side-by-side.
- `Layer.provide(X, Y)` — X satisfies Y's dependencies.
- `Layer.provideMerge(X, Y)` — like `provide` but also exposes X (useful when tests need to assert on the dependency).

```ts
const AppLayer = Logger.layer.pipe(Layer.provideMerge(Clock.layer))
```

Once `Effect.provide` satisfies all services, `R` reaches `never` and the Effect runs at the top level.

### Provide **once** at the edge

effect-solutions is explicit about this: call `Effect.provide` once in `main`, not scattered through business logic. Makes the dependency graph obvious, makes tests trivial (swap `appLayer` for `testLayer`), prevents hidden re-constructions.

## Layer memoization — the pool-doubling gotcha

Effect memoizes layers **by reference identity**. Call a parameterized layer constructor twice inline and you get two instances — two connection pools, two caches, two of everything:

```ts
// ❌ Two connection pools, each with 10 connections. Can hit server limits.
const badApp = Layer.mergeAll(
  UserRepo.layer.pipe(Layer.provide(Postgres.layer({ url, poolSize: 10 }))),
  OrderRepo.layer.pipe(Layer.provide(Postgres.layer({ url, poolSize: 10 }))),
)

// ✅ One pool, shared by both repos.
const pgLayer = Postgres.layer({ url, poolSize: 10 })
const goodApp = Layer.mergeAll(
  UserRepo.layer.pipe(Layer.provide(pgLayer)),
  OrderRepo.layer.pipe(Layer.provide(pgLayer)),
)
```

**Rule:** parameterized layer constructors → store the result in a const, reuse the const.

## Service-Driven Development

Sketch **leaf tags** across the graph *before* writing implementations. You can write higher-level orchestration that type-checks right away — the infra comes later.

```ts
// Leaf contracts — no impls yet
class Users extends Context.Service<Users, {
  readonly findById: (id: string) => Effect.Effect<{ id: string; email: string }>
}>()("app/Users") {}

class Emails extends Context.Service<Emails, {
  readonly send: (to: string, body: string) => Effect.Effect<void>
}>()("app/Emails") {}

// Higher-level service — already implementable against the leaf contracts
class Notifier extends Context.Service<Notifier, {
  readonly welcome: (userId: string) => Effect.Effect<void>
}>()("app/Notifier") {
  static readonly layer = Layer.effect(Notifier)(
    Effect.gen(function* () {
      const users = yield* Users
      const emails = yield* Emails

      const welcome = Effect.fn("Notifier.welcome")(function* (userId: string) {
        const u = yield* users.findById(userId)
        yield* emails.send(u.email, `Welcome, ${u.id}!`)
      })

      return { welcome }
    }),
  )
}
```

This lets you stabilise the *shape* of the system before picking a database or an email provider. Swap real layers in later without touching `Notifier`.

## Takeaways

- `Context.Service<Self, Shape>()("id")` declares the slot (`ServiceMap` in older betas).
- `static readonly layer` and `static readonly testLayer` — canonical attachment.
- `Effect.fn("Name.method")(function*() { ... })` for service methods.
- `Layer.succeed` / `Layer.effect` are **curried**.
- Provide once at the edge; sketch leaf tags first; store parameterized layers in a const.
