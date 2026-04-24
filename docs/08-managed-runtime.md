# 08 — ManagedRuntime

> Story: [`stories/08-managed-runtime.ts`](../stories/08-managed-runtime.ts)
> Reference: [`tbiz_ts/apps/b2c-studio/src/services/qilin.ts`](../../../works/tbiz_ts/apps/b2c-studio/src/services/qilin.ts)

## Why a ManagedRuntime?

You have an Effect-based core and a non-Effect shell — a React app, an Express route, a CLI. You want to run Effects from the shell without re-providing Layers on every call.

A `ManagedRuntime` is a pre-built, disposable runtime over a Layer. Build it once at the edge; run Effects as Promises from anywhere.

## Building one

```ts
const runtime = ManagedRuntime.make(UsersLive)
```

The argument is any Layer that produces the services your programs will need. Compose as big a graph as your app wants — `Layer.mergeAll`, `Layer.provide`, etc.

## Running Effects against it

```ts
// runPromise — happy path, throws on failure
const user = await runtime.runPromise(
  Effect.gen(function* () {
    const users = yield* Users
    return yield* users.get("1")
  }),
)

// runPromiseExit — inspectable, no throw
const exit = await runtime.runPromiseExit(myEffect)
```

**Prefer `runPromiseExit` at the edge**. It returns an `Exit<A, E>` — a plain value you can match on:

```ts
Exit.match(exit, {
  onSuccess: (u) => respond(200, u),
  onFailure: (cause) => {
    const err = Cause.findErrorOption(cause)
    if (Option.isSome(err)) {
      // err.value is the typed domain error
      return respond(mapToStatus(err.value), err.value)
    }

    // Defect — unexpected throw inside the Effect
    const defect = Cause.findDefect(cause)
    if (defect._tag === "Success") {
      log.fatal(defect.success)
      return respond(500, "internal error")
    }

    // Interruption — fiber was cancelled
    if (Cause.hasInterrupts(cause)) {
      return respond(499, "client disconnected")
    }
  },
})
```

`Cause` has three axes:

- **Typed errors** (what your code did with `Effect.fail`) — `Cause.findErrorOption`
- **Defects** (uncaught throws, truly unexpected) — `Cause.findDefect`
- **Interruptions** (cancelled fibers) — `Cause.hasInterrupts`

## Dispose when you're done

```ts
await runtime.dispose()
```

Runtimes hold scope-managed resources (e.g. HTTP connection pools, database clients from future chapters). Dispose them in cleanup hooks — React's `useEffect` cleanup, server shutdown signals, test `afterAll`.

## The v3 → v4 changes (trip hazards)

| v3                                    | v4                                     |
| ------------------------------------- | -------------------------------------- |
| `Runtime.Runtime<R>`                  | `ManagedRuntime.ManagedRuntime<R, E>`  |
| `Runtime.runPromiseExit(rt)(effect)`  | `rt.runPromiseExit(effect)`            |
| `mr.runtime().then(setRuntime)`       | `setRuntime(mr)` — the MR *is* the RT  |
| `Cause.failureOption`                 | `Cause.findErrorOption`                |
| `Cause.isInterrupted`                 | `Cause.hasInterrupts`                  |
| `Cause.dieOption` (returns `Option`)  | `Cause.findDefect` (returns `Result`)  |

The third row is the biggest behavioural change. In v3 you had to await an extra step (`mr.runtime()`) to get the actual runtime. In v4 the ManagedRuntime **is** the runtime — pass it along directly.

## Putting it together — React-flavored pseudocode

```tsx
function RuntimeProvider({ children }: PropsWithChildren) {
  const [runtime, setRuntime] = useState<ManagedRuntime.ManagedRuntime<Deps, never>>()

  useEffect(() => {
    const mr = ManagedRuntime.make(AppLive)
    setRuntime(mr)                        // v4: no .runtime()
    return () => { void mr.dispose() }
  }, [])

  if (!runtime) return null
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>
}
```

The `b2c-studio` app uses this exact shape for `QilinService` + `PegasusService`.

## Takeaways

- One runtime per app edge; dispose on shutdown.
- `runPromiseExit` + `Exit.match` is the production-safe way to run effects at edges.
- `Cause` separates typed errors, defects, and interruptions — handle each differently.
- Memorize the four v3 → v4 renames above; they're the ones you'll hit first.
