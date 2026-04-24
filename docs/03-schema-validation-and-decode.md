# 03 — Schema validation and decoding

> Story: [`stories/03-schema-validation-and-decode.ts`](../stories/03-schema-validation-and-decode.ts)
> Reference: [`tbiz_ts/packages/rpc-client/src/schemas/auth.ts`](../../../works/tbiz_ts/packages/rpc-client/src/schemas/auth.ts), [`.../form/validators.ts`](../../../works/tbiz_ts/packages/rpc-client/src/form/validators.ts)

Chapter 2 defined shapes. This chapter adds **rules** (runtime predicates), **defaults** (fill-in-the-blanks), and **decoders** (how to get a typed value out of unknown input).

## Attaching predicates with `check`

`Schema.check(predicate1, predicate2, …)` layers runtime checks onto a base schema:

```ts
const Email = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1, { message: "Email is required" }),
    Schema.isPattern(/.+@.+\..+/, { message: "Invalid email format" }),
  ),
)

const Password = Schema.String.pipe(
  Schema.check(Schema.isMinLength(8, { message: "Password too short" })),
)
```

Predicates come from the `Schema.is*` family:

- `isMinLength(n)`, `isMaxLength(n)`, `isNonEmpty()`, `isLengthBetween(a, b)`
- `isPattern(regExp)`
- `isGreaterThan(n)`, `isLessThan(n)`, `isGreaterThanOrEqualTo(n)`, ...
- `isGreaterThanDate(d)`, ... — same set for numbers, BigInts, BigDecimals, Dates

**v4 API note**: in v3 these were `Schema.minLength(n, opts)` / `Schema.pattern(re, opts)` applied directly. In v4 you wrap them in `Schema.check(...)`. Messages also changed from `{ message: () => "text" }` (thunk) to `{ message: "text" }` (plain string).

## The four decoders

`Schema.decodeUnknown*(schema)(value)` gives you the same computation, wrapped four different ways. Pick the envelope that suits the caller:

| Form                            | Returns                       | Use when                                      |
| ------------------------------- | ----------------------------- | --------------------------------------------- |
| `decodeUnknownSync(s)(v)`       | `T` (throws on failure)       | Quick-and-dirty decoding at boundaries        |
| `decodeUnknownExit(s)(v)`       | `Exit<T, SchemaError>`        | **Testing** — assert on `Exit.isSuccess`      |
| `decodeUnknownOption(s)(v)`     | `Option<T>`                   | You just want a yes/no, not an error          |
| `decodeUnknownEffect(s)(v)`     | `Effect<T, SchemaError>`      | Composing inside a larger Effect pipeline     |

The tbiz_ts test suite uses `decodeUnknownExit` uniformly — see the Insurance tests. It's the canonical test shape:

```ts
const exit = Schema.decodeUnknownExit(Insurance.Country)(sample)
expect(Exit.isSuccess(exit)).toBe(true)
```

## Filling in missing fields with `withDecodingDefault`

When a field is absent in the input, you can inject a default at decode time:

```ts
const UserPrefs = Schema.Struct({
  name:   Schema.String,
  rating: Schema.optional(Schema.Number).pipe(
    Schema.withDecodingDefault(Effect.succeed(0)),
  ),
  tags:   Schema.optional(Schema.Array(Schema.String)).pipe(
    Schema.withDecodingDefault(Effect.succeed([] as readonly string[])),
  ),
})
```

### Two gotchas

1. **v4-beta.57 takes an `Effect`, not a thunk.** Use `Effect.succeed(value)` as shown. (tbiz_ts code for beta.31 uses `() => value` — that won't compile here.)
2. **The output type still shows `T | undefined`.** `withDecodingDefault` guarantees the value at runtime, but TypeScript doesn't know that. Guard reads with `prefs.rating ?? 0` if the language service flags `undefined`.

## Walking SchemaIssue for per-field error messages

The default error from `decodeUnknownSync` is a formatted tree. For form UIs you usually want `{ fieldName: "message" }`. Walk the `SchemaIssue` tree:

```ts
function collectFieldErrors(
  issue: SchemaIssue.Issue,
  path: string[] = [],
): Record<string, string> {
  switch (issue._tag) {
    case "Pointer":  // path segment — push and recurse
    case "Filter":
    case "Encoding": // pass through, recurse into .issue
    case "Composite": // recurse over all children
    default:        // terminal — record at current path
  }
}
```

The v3 → v4 tag renames are important here:

| v3 `ParseIssue._tag` | v4 `SchemaIssue._tag` |
| -------------------- | --------------------- |
| `"Type"`             | `"InvalidType"`       |
| `"Refinement"`       | `"Filter"`            |
| `"Missing"`          | `"MissingKey"`        |
| `"Unexpected"`       | `"UnexpectedKey"`     |
| `"Transformation"`   | `"Encoding"`          |

The full implementation is in [`tbiz_ts/packages/rpc-client/src/form/validators.ts`](../../../works/tbiz_ts/packages/rpc-client/src/form/validators.ts) — it wires into TanStack Form.

## Extracting the error from an `Exit`

`Exit.match`'s `onFailure` gives you a `Cause<SchemaError>`, not a bare error. Extract the typed error with `Cause.findErrorOption`:

```ts
Exit.match(exit, {
  onSuccess: () => {},
  onFailure: (cause) => {
    const err = Cause.findErrorOption(cause)
    if (Option.isSome(err)) {
      const fields = collectFieldErrors(err.value.issue)
      // ...
    }
  },
})
```

You'll use this extraction pattern repeatedly — it's covered again in chapter 8.

## Takeaways

- Attach rules with `Schema.check(Schema.isX(...))`.
- `decodeUnknownExit` is the idiomatic choice for tests.
- `withDecodingDefault(Effect.succeed(v))` fills defaults; guard reads with `??` anyway.
- The SchemaIssue tag renames trip people — memorize them or keep the table above bookmarked.
