# Missionary ↔ Effect-TS — primitive-by-primitive comparison

> Companion reference, not a numbered chapter. Read this when you already know one side and want to map across.
>
> - **Missionary** ([leonoel/missionary](https://github.com/leonoel/missionary), Clojure/ClojureScript) at version **b.47** — author: Leo Noel. Single namespace: `missionary.core` (aliased `m` throughout).
> - **Effect-TS** (`effect@4.0.0-beta.57`, the "effect-smol" line consolidated into a single package). Examples assume the imports in the rest of these docs.
>
> Verified against [`leonoel/missionary` master](https://github.com/leonoel/missionary/blob/master/src/missionary/core.cljc) on 15-May-2026.

## TL;DR mental model

Both libraries describe *programs as values*. Nothing runs on construction; you compose lazy descriptions and execute them at the edges with structured supervision, typed cancellation, and resource safety. The two map cleanly:

| Missionary | Effect | What it is |
|:-----------|:-------|:-----------|
| `task` | `Effect<A, E>` | A lazy single-shot async computation. Success or failure. Cancellable. |
| discrete `flow` | `Stream<A, E, R>` | A pull-based async sequence with backpressure. |
| continuous `flow` (`m/cp`, `m/signal`) | (no direct equivalent) | A time-varying value sampled on demand — FRP signal. |
| `dfv` | `Deferred<A, E>` | One-shot promise / single-assignment cell. |
| `mbx` | `Queue<A>` (unbounded) | Async mailbox. |
| `rdv` | `Queue<A>` (capacity 1, synchronous handoff) | Rendezvous / sync channel. |
| `sem` | `Semaphore` | Counted permit. |

**The big asymmetry:** Effect carries an extra type parameter `R` for required services (dependency injection through `Context.Tag` + `Layer`). Missionary has nothing analogous — Clojure isn't statically typed that way, so dependencies travel through dynamic vars, closure capture, or plain arguments. A Missionary `task` is best read as `Effect<A, E, never>`.

**Surface area difference:** A Missionary task is literally a 2-arg function `(success, failure) -> cancel` — a tiny CPS protocol. Effect is a much larger runtime: fibers, scheduler, supervision tree, structured concurrency, `Cause`, `Exit`, schedules, metrics, tracing, layers, STM. The conceptual contracts line up; the implementations don't.

---

## 1. Sequential composition

### Missionary

`m/sp` (sequential process) returns a task whose body is rewritten so that `m/?` can park on inner tasks without blocking the host thread.

```clojure
(def fetch-and-greet
  (m/sp
    (let [user (m/? (load-user 42))]
      (println "Hi," (:name user))
      (m/? (m/sleep 1000))
      user)))
```

`m/?` **parks** the current evaluation context until the inner task completes; on failure it rethrows.

### Effect

`Effect.gen` is the equivalent macro; `yield*` plays the role of `m/?`. With `Effect.fn` you also pick up call-site traces and a named span (recommended for any Effect-returning function, see [chapter 01](./01-basics.md)).

```ts
const fetchAndGreet = Effect.fn("fetchAndGreet")(function* () {
  const user = yield* loadUser(42)
  yield* Console.log(`Hi, ${user.name}`)
  yield* Effect.sleep("1 second")
  return user
})
```

| Missionary | Effect | Notes |
|:-----------|:-------|:------|
| `m/sp` | `Effect.gen` / `Effect.fn` | Sequential body in a macro/generator |
| `m/?` (in `sp`/`ap`) | `yield*` | Await a single inner |
| `m/?` (outside) | `Effect.runPromise` / `runSync` | Top-level "run this" |

Both are *syntactic supersets* of the host language inside the macro: branching, loops, `try/finally`, destructuring all work normally.

---

## 2. Task constructors

| Missionary | Effect | Notes |
|:-----------|:-------|:------|
| `(m/sp …)` | `Effect.gen(function*() { … })` | Sequential body |
| Plain value | `Effect.succeed(x)` | Pure success |
| `(throw …)` inside `sp` | `Effect.fail(e)` / yieldable error | Pure failure |
| `(m/sleep ms)` | `Effect.sleep("N millis")` | Delay |
| `m/never` | `Effect.never` | Never completes; cancellable |
| `m/none` | `Stream.empty` | Empty flow |
| `(m/via m/blk …)` | `Effect.blocking(…)` | Run body on the blocking pool (JVM only on the Missionary side — JS is single-threaded, so `Effect.blocking` is a no-op semantic marker) |
| `(m/via m/cpu …)` | (n/a in JS) | CPU-bound pool — only meaningful on the JVM |
| `m/compel` | `Effect.uninterruptible` | Suppress cancellation for the wrapped task |

### `via` deserves a note

On the JVM, blocking APIs are common — `Thread/sleep`, JDBC calls, file I/O. Because Missionary runs user code *on the calling thread* by default, blocking a thread can stall the whole graph. `m/via m/blk` offloads to a separate executor:

```clojure
(m/? (m/via m/blk (slurp "huge-file.txt")))
```

In Effect-TS this is `Effect.blocking(...)`, but on Bun/Node JS it doesn't migrate work to another thread (JS is single-threaded); it just hints to the runtime that this fiber may park the loop. Truly blocking JS code is rare — what you usually have is *long synchronous CPU work*, for which you'd reach for `Worker` (or in Effect, an external pool layer), not `Effect.blocking`.

---

## 3. Concurrent task combinators

Missionary distinguishes three "race-ish" combinators with subtly different semantics:

| Missionary | Effect | Semantics |
|:-----------|:-------|:----------|
| `(m/join f & ts)` | `Effect.all([…], { concurrency: "unbounded" })` then map with `f` | Run all concurrently. **Any failure cancels the rest and propagates.** All success → `(apply f results)`. |
| `(m/race & ts)` | `Effect.race(a, b)` / `Effect.firstSuccessOf([…])` | First **success** wins; cancels others. All fail → race fails. |
| `(m/any & ts)` | `Effect.raceFirst(a, b)` / `Effect.raceAllFirst([…])` | First task to **complete at all** wins (success or failure); cancels others. |
| `(m/all f & ts)` | `Effect.all(ts.map(Effect.either))` then map with `f` | "Settle all, then aggregate" — never short-circuits on failure. Closest JS analogue is `Promise.allSettled`. |
| `(m/timeout t ms)` / `(m/timeout t ms v)` | `Effect.timeout(t, "N millis")` / `Effect.timeoutTo({ … })` | Cancel after delay; optionally return a fallback value. |
| `(m/attempt t)` | `Effect.either(t)` / `Effect.exit(t)` | Catch failure as a value (Missionary wraps in a thunk; Effect produces `Either<E, A>` or `Exit<A, E>`). |
| `(m/absolve t)` | (paired with `Effect.either` round-trip) | Unwrap the thunk produced by `attempt` back into normal task semantics. |
| `m/compel` | `Effect.uninterruptible` | Discard cancellation. |

### Worked example — supervision on failure

The Missionary tutorial uses this to show that `join` cancels siblings when one branch fails:

```clojure
(def slow   (m/sp (println "Hi") (m/? (m/sleep 2000)) (println "done")))
(def crash  (m/sp (println "Hi") (m/? (m/sleep 500))
                  (throw (ex-info "Boom" {}))))

(m/? (m/join vector slow crash))
;; "Hi" "Hi" — then 500ms later, the whole thing fails;
;;             `slow` is cancelled before its "done" prints.
```

The Effect equivalent has the same supervision guarantee out of the box:

```ts
const slow  = Effect.gen(function* () {
  yield* Console.log("Hi")
  yield* Effect.sleep("2 seconds")
  yield* Console.log("done")
})
const crash = Effect.gen(function* () {
  yield* Console.log("Hi")
  yield* Effect.sleep("500 millis")
  return yield* Effect.fail(new Error("Boom"))
})

await Effect.runPromise(Effect.all([slow, crash], { concurrency: "unbounded" }))
// Logs "Hi" "Hi", then fails after 500ms; `slow` is interrupted before logging "done".
```

Both libraries call this *structured concurrency*: child lifetimes are bounded by their parent, and parent termination interrupts children.

---

## 4. Cancellation

Both libraries treat cancellation as a first-class, cooperative signal that propagates down the supervision tree.

| Missionary | Effect | Notes |
|:-----------|:-------|:------|
| Dispose function returned by running a task: `((my-task) success failure)` returns a `cancel!` thunk | Interrupting a fiber: `Fiber.interrupt(fiber)` / `Effect.interrupt` | Imperative trigger |
| `(m/!)` | (automatic at suspension points; `Effect.yieldNow` to insert one) | Manual cancellation check |
| `missionary.Cancelled` (catchable) | `Effect.isInterrupted` / `Cause.isInterrupted(cause)` | Detect interruption |
| `(m/compel task)` | `Effect.uninterruptible(eff)` | Make a region uncancellable |
| `try/finally` in `sp` | `Effect.ensuring` / `Effect.addFinalizer` (in a `Scope`) | Run cleanup regardless of outcome |

**Important shape difference:** Effect's failure channel distinguishes ordinary failures (`Fail`) from interruption (`Interrupt`) from defects (`Die`) — see `Cause<E>`. Missionary's `Cancelled` is just a particular exception value (`missionary.Cancelled`) which you can `catch` and convert to whatever you like (often by emitting `(m/amb)` to mean "no value here").

---

## 5. Communication primitives

These are the *conveyance devices* — what Leo's README calls the "first-class primitive of imperative concurrency". They show up when you need to move values between sibling branches of a supervision tree.

| Missionary | Effect | Use case |
|:-----------|:-------|:---------|
| `(m/dfv)` — dataflow variable | `Deferred.make<A, E>()` | One-shot promise. First `assign` wins; later `deref`s receive the bound value. |
| `(m/mbx)` — mailbox | `Queue.unbounded<A>()` | Unbounded async queue (push from anywhere, pull one at a time). |
| `(m/rdv)` — rendezvous | `Queue.bounded<A>(1)` + handoff (no direct primitive) | Synchronous handoff: sender parks until a receiver is ready. |
| `(m/sem n)` — semaphore | `Semaphore.make(n)` | Counted permit. |
| `(m/holding sem …)` | `Semaphore.withPermits(1)` / `withPermit` | Bracket a body in acquire/release. |
| Actor pattern: `mbx` + `sp` loop (`actor` helper in the docs) | `Queue` + `Fiber` + `forkScoped`, or `effect/Cluster` virtual actors | Encapsulated stateful process consuming messages. |

### Actor sketch — side by side

Missionary's own example from the source:

```clojure
(defn actor
  ([init] (actor init crash))
  ([init fail]
   (let [self (m/mbx)]
     ((m/sp
        (loop [b init]
          (recur (b self (m/? self)))))
      nil fail)
     self)))

(def counter
  (actor
    ((fn beh [n]
       (fn [self cust]
         (cust n)
         (beh (inc n)))) 0)))

(counter prn)   ;; => 0
(counter prn)   ;; => 1
```

A first-cut Effect equivalent (no Cluster):

```ts
const makeActor = <Msg>(initial: (self: Queue.Queue<Msg>, msg: Msg) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    const self = yield* Queue.unbounded<Msg>()
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const msg = yield* Queue.take(self)
          yield* initial(self, msg)
        })
      )
    )
    return self
  })
```

For first-class location-transparent actors (supervision, persistence, sharding) Effect's answer is the [Effect Cluster / virtual actor pattern](./08-managed-runtime.md) rather than rolling them on `Queue` + `Fiber`.

---

## 6. Memoization

`m/memo` turns a task into a *publisher task* that runs at most once across all subscribers and shares the result. Cancelled while no subscribers remain → cancels the underlying task.

```clojure
(def fib42
  (m/memo
    (m/via m/cpu
      (println "Computing 42nd fibonacci...")
      (fib 42))))

(fib42 prn prn) ;; runs the computation
(fib42 prn prn) ;; reuses the result
```

The Effect counterpart is `Effect.cached`:

```ts
const fib42 = Effect.cached(
  Effect.sync(() => {
    console.log("Computing 42nd fibonacci...")
    return fib(42)
  })
)
// Use:
const program = Effect.gen(function* () {
  const cached = yield* fib42   // get the cached effect once
  const a = yield* cached       // runs the computation
  const b = yield* cached       // reuses the result
})
```

`Effect.cachedWithTTL` adds time-based invalidation; `Effect.cachedFunction` keys the cache by argument. Missionary's `memo` is the unkeyed-no-TTL case.

---

## 7. Flows — discrete pull streams

A `flow` is "a value representing a process able to produce an arbitrary number of values before terminating" — Missionary's [Hello flow](https://github.com/leonoel/missionary/blob/master/doc/tutorials/hello_flow.md). All flows support backpressure: a downstream consumer must pull for the upstream to advance.

This is the direct shape of Effect's `Stream<A, E, R>`.

### Constructors

| Missionary | Effect | Notes |
|:-----------|:-------|:------|
| `(m/seed coll)` | `Stream.fromIterable(coll)` | Emit values from a finite collection |
| `(m/watch ref)` | `SubscriptionRef.changes(ref)` | Observe a reference / atom as a flow of states |
| `(m/observe (fn [emit] cleanup-thunk))` | `Stream.async((emit) => …, cleanup)` / `Stream.asyncEffect(…)` | Bridge a callback API to a flow |
| `m/none` | `Stream.empty` | Empty |
| `(m/sleep-emit delays)` | `Stream.fromSchedule(Schedule.spaced(…))` (roughly) | Emit on a delay schedule |

### Consumption

| Missionary | Effect | Notes |
|:-----------|:-------|:------|
| `(m/reduce rf flow)` / `(m/reduce rf init flow)` | `Stream.runFold(flow, init, rf)` | Reduce a flow to a value |
| `(m/reductions rf flow)` | `Stream.scan(flow, init, rf)` | Emit running aggregates |
| `(m/eduction xf… flow)` | `Stream.pipeThrough` / `Stream.mapChunks` | Apply a transducer / transformer |

### Time and combination

| Missionary | Effect | Notes |
|:-----------|:-------|:------|
| `(m/zip f & flows)` | `Stream.zip` / `Stream.zipWith` | Element-wise combine |
| `(m/latest f & flows)` | `Stream.zipLatest` / `Stream.zipLatestWith` | Always combine the latest from each |
| `(m/sample f sampler signal)` | `Stream.sample` / custom via `Stream.zipLatest` | Sample a signal on discrete events |
| `(m/buffer n flow)` | `Stream.buffer({ capacity: n })` | Buffer N values |
| `(m/relieve sg flow)` | `Stream.aggregate` / `Stream.throttle` | Decouple rates; merge overflow via a semigroup |
| `(m/group-by kf flow)` | `Stream.groupBy` | Partition by key |
| `(m/delay-each ms flow)` | `Stream.schedule(Schedule.spaced("N millis"))` | Pace emissions |

### Sharing one process across many consumers

| Missionary | Effect | Notes |
|:-----------|:-------|:------|
| `(m/stream flow)` | `Stream.share` / `Stream.broadcast` / `PubSub` | Multicast a single flow process to N subscribers |
| `(m/signal flow)` / `(m/signal sg flow)` | `SubscriptionRef` + `subscribe` | Multicast a *continuous* flow — late subscribers get the latest value |
| `(m/store init)` / `(m/store sg init)` | Custom: `Ref` + `PubSub` | Append-only log of deltas with grouping, frozen on dispose |
| `(m/publisher flow)` / `(m/subscribe pub)` | `Stream` ↔ Reactive-Streams `Publisher` interop | Reactive-Streams compliance |

---

## 8. Ambiguous evaluation (`ap`)

This is where Missionary leans into something Effect doesn't have a direct syntactic equivalent for: an *ambiguous process* macro where each `?>` fork *backtracks* over multiple values, producing a flow.

```clojure
;; A flow that prints each value and sleeps a second between
(def hello-world
  (m/ap
    (println (m/?> (m/seed ["Hello" "World" "!"])))
    (m/? (m/sleep 1000))))

(m/? (m/reduce conj hello-world))
;; "Hello" "World" "!" — then [nil nil nil]
```

`m/?>` pulls one value, forks evaluation, and continues to the end of the body. After the body completes, evaluation *backtracks* to the fork point and pulls another value. With an extra `par` argument it forks concurrently:

```clojure
;; Concurrent fan-out: sleep `ms` then return ms, for each ms in the input.
;; ##Inf = unlimited concurrency.
(m/? (m/reduce conj
       (m/ap (let [ms (m/?> ##Inf (m/seed [300 100 400 200]))]
               (m/? (m/sleep ms ms))))))
;; => [100 200 300 400]   (order of completion)
```

The equivalent in Effect is `Stream.flatMap` (or `Effect.forEach` with `concurrency`):

```ts
const program = Stream.fromIterable([300, 100, 400, 200]).pipe(
  Stream.flatMap(
    (ms) => Stream.fromEffect(Effect.sleep(`${ms} millis`).pipe(Effect.as(ms))),
    { concurrency: "unbounded" }
  ),
  Stream.runCollect
)
// => Chunk(100, 200, 300, 400)
```

| Missionary | Effect | Notes |
|:-----------|:-------|:------|
| `(m/ap …)` | `Stream.fromEffect` + `Stream.flatMap` (or `Stream` generators) | Build a flow with sequential side-effects per value |
| `(m/?> flow)` | `Stream.flatMap(…, { concurrency: 1 })` | Pull one value, fork, backtrack |
| `(m/?> n flow)` | `Stream.flatMap(…, { concurrency: n })` | Same, with N concurrent forks |
| `(m/?> ##Inf flow)` | `Stream.flatMap(…, { concurrency: "unbounded" })` | All-at-once fan-out |
| `(m/?< flow)` (switch) | `Stream.switchMap` / `Stream.flatMapSwitch` | Preemptive: a new value cancels in-flight processing |
| `(m/amb a b c)` | `Stream.concat(Stream.succeed(a), …)` | Sequential alternation |
| `(m/amb= a b c)` | `Stream.merge` of `Stream.succeed`s | Concurrent alternation |
| `(m/amb)` (no args) | `Stream.empty` | Emit nothing — used to drop values in switches |

### Debounce with `?<`

The classic example of preemptive switching:

```clojure
(defn debounce [delay flow]
  (m/ap (let [x (m/?< flow)]
          (try (m/? (m/sleep delay x))
               (catch missionary.Cancelled _ (m/amb))))))
```

In Effect:

```ts
const debounce = <A, E, R>(flow: Stream.Stream<A, E, R>, ms: number) =>
  flow.pipe(Stream.debounce(`${ms} millis`))
```

(Effect provides `Stream.debounce` as a built-in; the Missionary version shows how the same semantics fall out of `?<` + `sleep` + `Cancelled`.)

---

## 9. Continuous flows (`cp`, `signal`, `watch`) — Effect's missing piece

A *continuous flow* is a time-varying value sampled on demand: when a downstream pulls, it sees whatever the current value is, not a queued historical one. This is the FRP / dataflow piece — and it's the one corner of Missionary that Effect doesn't directly mirror.

```clojure
(def !x (atom 0))
(def !y (atom 0))

(def main
  (m/reactor
    (let [<x (m/signal (m/watch !x))
          <y (m/signal (m/watch !y))
          <sum (m/signal (m/latest + <x <y))]
      (m/stream! (m/ap (println "sum =" (m/?< <sum)))))))

(def dispose! (main prn prn))
(swap! !x inc) ;; prints "sum = 1"
(swap! !y inc) ;; prints "sum = 2"
(dispose!)
```

The killer feature here is *glitch freedom*: when `!x` and `!y` change "simultaneously" (within one reactor cycle), the dependent `<sum` recomputes once with the consistent new values, never with an intermediate inconsistent state. That property is hard to retrofit on a stream library.

Effect's closest analogues are partial:

- **`SubscriptionRef`** — a `Ref` with a `changes: Stream` view. Multiple subscribers each see all changes, but there's no glitch-free DAG.
- **`Stream.zipLatest`** — combine streams keeping the latest value of each. Doesn't guarantee glitch freedom under simultaneous updates.
- **External FRP** — Solid signals, MobX, etc. — for actual reactive DAGs in JS, you reach outside Effect.

If your problem is *signals composing into a DAG* (think spreadsheet, reactive UI, incremental view maintenance), Missionary's reactor + `signal` is genuinely better-suited than anything in Effect today. Effect's strength is the *task* side and discrete streaming.

---

## 10. Resource management

| Missionary | Effect | Notes |
|:-----------|:-------|:------|
| `try/finally` inside `sp` | `Effect.ensuring` | Cleanup regardless of success/failure/interruption |
| Scope-bound resources via `m/ap` + flow lifetime | `Scope` + `Effect.acquireRelease` | Effect formalises *resource scope* as a first-class value |
| Disposal returned by running a task | `Fiber.interrupt` / `Scope.close` | External cleanup trigger |
| `(m/observe …)` cleanup thunk | `Stream.asyncScoped` finaliser | Bridge a callback subscription with cleanup |

Effect's `Scope` is more formal: a resource is acquired *into* a scope, automatic cleanup runs when the scope closes, and scopes nest naturally. Missionary's resource story is "lifetime = flow/task lifetime + `finally` blocks", which is lighter but covers the common cases.

---

## 11. Reactive Streams interop

Both libraries can speak the [Reactive Streams](https://www.reactive-streams.org/) protocol, which means they can be wired together via that bridge — but in practice you'd run only one library inside a process and use the other only at the edges.

| Missionary | Effect | Notes |
|:-----------|:-------|:------|
| `(m/publisher flow)` | `Stream.toPublisher` *(via interop layer)* | Flow → RS Publisher |
| `(m/subscribe pub)` | `Stream.fromPublisher` *(via interop layer)* | RS Publisher → Flow |

---

## 12. Cheat-sheet for porting code

Going **Missionary → Effect**:

1. `m/sp` → `Effect.fn("name")(function*() { … })`
2. `m/?` → `yield*`
3. `m/?>` / `?<` inside `m/ap` → `Stream.flatMap` / `Stream.switchMap`
4. `m/join`/`m/race`/`m/any` → `Effect.all` / `Effect.race` / `Effect.raceFirst`
5. `m/timeout` → `Effect.timeout`
6. `m/dfv` → `Deferred`
7. `m/mbx` → `Queue.unbounded`
8. `m/sem` → `Semaphore.make`
9. `m/memo` → `Effect.cached`
10. `m/via m/blk` → `Effect.blocking` *(but read §2 — JS is single-threaded)*
11. `m/watch !atom` → `SubscriptionRef.changes`
12. `m/signal` / `m/cp` → no direct equivalent; reach for `SubscriptionRef` + `Stream.zipLatest` for the discrete subset, or an external FRP lib for true reactive DAGs

Going **Effect → Missionary**:

1. `Effect.gen` → `m/sp`
2. `yield*` → `m/?`
3. `Effect.all([…], { concurrency })` → `(m/join vector …)`
4. `Effect.race` → `m/race`; `Effect.raceFirst` → `m/any`
5. `Effect.either` → `m/attempt`
6. `Effect.orDie` → `m/compel` (close cousin — silences cancellation, not failure; for true "promote failure to defect" you'd `m/sp` + rethrow)
7. `Context.Tag` + `Layer` → no equivalent — pass values as arguments or via dynamic vars
8. `Stream.fromIterable` → `m/seed`; `Stream.flatMap` → `m/ap` + `?>`
9. `Effect.acquireRelease` + `Scope` → `try/finally` in `m/sp`, lifetime-of-flow scoping
10. `SubscriptionRef` → `m/watch` of an atom, optionally wrapped in `m/signal`

---

## 13. When to reach for which

**Missionary shines when:**

- You're writing **Clojure / ClojureScript**, especially with reactive UI (Electric, re-frame-style apps).
- You need **glitch-free reactive DAGs** — a spreadsheet, a derived-state graph, incremental view maintenance.
- You want a **small, foundational toolkit** with no opinions about runtime/services/DI.
- You like **macros as language extension** — `sp` / `ap` / `cp` are genuinely first-class in the host language.

**Effect-TS shines when:**

- You're writing **TypeScript** and want first-class types tracking errors, dependencies, and effects.
- You want **`Layer`-based dependency injection** with compile-time wiring checks.
- You're building services with **structured tracing, metrics, retries, schedules** out of the box.
- You need **production HTTP / RPC** plumbing (`HttpApi`, `RpcServer`) on a unified runtime.
- You want **distributed actors / persistence** via Effect Cluster.

The two are philosophical cousins — both descend from "programs as values, supervised by structure". They diverge most on:

- *Types*: Effect leans hard on the `<A, E, R>` channel; Missionary is dynamic.
- *Scope*: Missionary is a focused dataflow toolkit; Effect is a sprawling platform.
- *FRP*: Missionary has real glitch-free signals; Effect doesn't.
- *DI*: Effect has formal layers; Missionary doesn't try.

---

## References

- Missionary upstream: <https://github.com/leonoel/missionary> (verified at master, May 2026, release `b.47`)
- API reference: [`missionary.core`](https://cljdoc.org/d/missionary/missionary/CURRENT/api/missionary.core)
- Hello task tutorial: <https://github.com/leonoel/missionary/blob/master/doc/tutorials/hello_task.md>
- Hello flow tutorial: <https://github.com/leonoel/missionary/blob/master/doc/tutorials/hello_flow.md>
- Effect docs: <https://effect.website/>
- This repo's chapter on services & layers (the part Missionary doesn't model): [`05-services-and-layers.md`](./05-services-and-layers.md)
- Project-internal KB equivalence note: `~/github/mydoc2024/docs/guide/100_clojure/missionary.md#missionary--effect-ts-equivalences`
