# 02 — Schema: data modeling

> Story: [`stories/02-schema-data-modeling.ts`](../stories/02-schema-data-modeling.ts)
> Reference: [`tbiz_ts/packages/schema/src/trip.ts`](../../../works/tbiz_ts/packages/schema/src/trip.ts), [`hotel.ts`](../../../works/tbiz_ts/packages/schema/src/hotel.ts)

## What is a Schema?

A `Schema<T>` is **both** a runtime validator and a TypeScript type. One definition, two uses. The TypeScript type is **derived** from the schema, not declared separately — you never drift.

effect-solutions teaches four big ideas. We follow them here:

1. Use **`Schema.Class`** for composite records (adds methods).
2. Use **`Schema.TaggedClass` + `Schema.Union`** for structured variants, pair with **`Match.valueTags`** for exhaustive matching.
3. **Brand nearly every** domain primitive — not just IDs.
4. Use **`Schema.fromJsonString`** for JSON codecs in one step.

## Schema.Class — composite records with methods

```ts
class User extends Schema.Class<User>("User")({
  id: UserId,
  name: Schema.String,
  email: Email,
  createdAt: Schema.String,
}) {
  get displayName() {
    return `${this.name} <${this.email}>`
  }
}

const alice = new User({ id: ..., name: "Alice", ... })
console.log(alice.displayName) // "Alice <...>"
```

Construct with `new`. Pass a plain object matching the field schemas. Validation runs at construction time (and throws `SchemaError` on bad input — or you can decode instead with `Schema.decodeUnknownSync(User)(...)`).

`Schema.Struct({...})` still exists and still works for ad-hoc shapes. Prefer `Schema.Class` when you have something that looks like a domain type.

## Schema.TaggedClass + Schema.Union for variants

```ts
class PaymentSucceeded extends Schema.TaggedClass<PaymentSucceeded>("PaymentSucceeded")(
  "PaymentSucceeded",
  { transactionId: Schema.String, amount: Schema.Number },
) {}

class PaymentFailed extends Schema.TaggedClass<PaymentFailed>("PaymentFailed")(
  "PaymentFailed",
  { reason: Schema.String, retryable: Schema.Boolean },
) {}

const PaymentResult = Schema.Union([PaymentSucceeded, PaymentFailed])
type PaymentResult = typeof PaymentResult.Type
```

Each variant auto-gets a literal `_tag` field. Match on it with `Match.valueTags` — the compiler enforces exhaustiveness:

```ts
const describe = (r: PaymentResult) =>
  Match.valueTags(r, {
    PaymentSucceeded: ({ transactionId, amount }) => `OK ${transactionId} ($${amount})`,
    PaymentFailed: ({ reason, retryable }) =>
      retryable ? `retry: ${reason}` : `abort: ${reason}`,
  })
```

Add a new variant, and TypeScript tells you where you need to update the match.

## Brand nearly every primitive

Branded types prevent mixing values that have the same underlying runtime type but different meaning. In a healthy domain, you have dozens of them — IDs, emails, URLs, ports, percentages, slugs, currency codes.

```ts
export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export const PostId = Schema.String.pipe(Schema.brand("PostId"))

export const Email = Schema.String.pipe(
  Schema.check(Schema.isPattern(/.+@.+\..+/, { message: "invalid email" })),
  Schema.brand("Email"),
)

export const Port = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  Schema.brand("Port"),
)
```

Construct branded values by decoding:

```ts
const port: Port = Schema.decodeUnknownSync(Port)(8080)
```

`getUser(userId)` will compile; `getUser(postId)` won't. Same with `Email` vs raw string. You pay one line of boilerplate and get a type error every time someone would've silently passed the wrong kind of value.

### `.makeUnsafe` / `Schema.make`

Later Effect betas ship a runtime `.makeUnsafe` method on branded schemas for cheap construction without decoding. In beta.57 it isn't exposed yet — use `Schema.decodeUnknownSync(Brand)(value)` as the portable form.

## The v4 array-form trap

`Schema.Union`, `Schema.Tuple`, and **multi-value** `Schema.Literals` all take a single array argument in v4:

```ts
// v4  ✅
Schema.Literals(["DINAS", "TRAINING", "CONFERENCE"])
Schema.Union([Schema.String, Schema.Number])
Schema.Tuple([Schema.Number, Schema.Number])

// v3  ❌ (compile error in v4)
Schema.Literal("DINAS", "TRAINING", "CONFERENCE")
Schema.Union(Schema.String, Schema.Number)
```

Single-value `Schema.Literal("2.0")` is unchanged. `Schema.Record(K, V)` takes positional args.

## `optional` vs `NullOr`

- `Schema.optional(X)` — the **key** may be missing.
- `Schema.NullOr(X)` — the **value** may be `null`.

Real APIs often use both: `phone: Schema.optional(Schema.NullOr(Schema.String))`.

## Arrays are readonly

`Schema.Array(X)` produces `readonly T[]`. Component props consuming schema-derived data must accept `readonly T[]`.

## JSON in one step: `Schema.fromJsonString`

Parse + validate together (or encode + stringify together) with a single schema:

```ts
const UserFromJson = Schema.fromJsonString(User)

const decoded = await Effect.runPromise(
  Schema.decodeUnknownEffect(UserFromJson)(
    '{"id":"u-2","name":"Bob","email":"bob@example.com",...}'
  )
)
// decoded is a User instance — with displayName getter and everything
```

Beats `JSON.parse` + `Schema.decodeUnknownSync(User)` in two ways: one fewer step, and JSON parse errors flow through the Effect error channel instead of throwing separately.

## Takeaways

- **Records** → `Schema.Class("Name")({...})` with methods.
- **Variants** → `Schema.TaggedClass` + `Schema.Union` + `Match.valueTags`.
- **Primitives** → brand everything with domain meaning.
- Array-form for `Union`, `Tuple`, multi-`Literals`.
- `Schema.fromJsonString` for JSON codecs.
