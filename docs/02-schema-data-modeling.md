# 02 — Schema: data modeling

> Story: [`stories/02-schema-data-modeling.ts`](../stories/02-schema-data-modeling.ts)
> Reference: [`tbiz_ts/packages/schema/src/trip.ts`](../../../works/tbiz_ts/packages/schema/src/trip.ts), [`hotel.ts`](../../../works/tbiz_ts/packages/schema/src/hotel.ts)

## What is a Schema?

A `Schema<T>` is **both** a runtime validator and a TypeScript type. One definition, two uses:

```ts
const Price = Schema.Struct({
  amount: Schema.Number,
  currency: Schema.String,
})

type Price = Schema.Schema.Type<typeof Price>
//   ^? { readonly amount: number; readonly currency: string }

const parsed = Schema.decodeUnknownSync(Price)(input)   // throws on failure
```

The TypeScript type is **derived** from the schema, not declared separately. You never drift between them.

## The v4 primitives

| Schema                             | Describes                                  |
| ---------------------------------- | ------------------------------------------ |
| `Schema.Struct({...})`             | Product type (object with known keys)      |
| `Schema.Literal("x")`              | Single literal value                       |
| `Schema.Literals(["a","b","c"])`   | **Multi**-literal union (array form!)      |
| `Schema.Union([A, B, C])`          | Sum type (array form!)                     |
| `Schema.Tuple([A, B])`             | Fixed-length tuple (array form!)           |
| `Schema.Record(K, V)`              | Record (positional args)                   |
| `Schema.Array(X)`                  | Readonly array                             |
| `Schema.optional(X)`               | Field may be missing                       |
| `Schema.NullOr(X)`                 | Value may be `null`                        |
| `Schema.String.pipe(Schema.brand("UserId"))` | Nominal type — `string & Brand<"UserId">` |

### The array-form trap

`Schema.Union`, `Schema.Tuple`, and **multi-value** `Schema.Literals` all take a single array argument in v4. In v3 they were variadic. Easy to miss when you're porting code or reading LLM-generated examples:

```ts
// v4  ✅
Schema.Literals(["DINAS", "TRAINING", "CONFERENCE"])
Schema.Union([Schema.String, Schema.Number])
Schema.Tuple([Schema.Number, Schema.Number])

// v3  ❌ (compile error in v4)
Schema.Literal("DINAS", "TRAINING", "CONFERENCE")
Schema.Union(Schema.String, Schema.Number)
Schema.Tuple(Schema.Number, Schema.Number)
```

Single-value `Schema.Literal("2.0")` is unchanged.

## `optional` vs `NullOr`

They look similar but they're orthogonal:

- `Schema.optional(X)` — the **key** may be missing.
- `Schema.NullOr(X)` — the **value** may be `null`.

Real APIs often use both:

```ts
Schema.Struct({
  email: Schema.NullOr(Schema.String),                    // null allowed, key required
  phone: Schema.optional(Schema.NullOr(Schema.String)),   // null OR missing
})
```

## Arrays are readonly

`Schema.Array(X)` produces `readonly T[]`. This means any component that consumes schema-derived data must accept a `readonly` array:

```ts
function renderPassengers(pax: readonly TripPax[]) { ... }  // ✅
function renderPassengers(pax: TripPax[]) { ... }           // ❌ won't accept readonly input
```

`tbiz_ts` calls this out explicitly in its CLAUDE.md — it's a common source of TypeScript friction.

## Brands — nominal types on the cheap

```ts
const UserId = Schema.String.pipe(Schema.brand("UserId"))
type UserId  = Schema.Schema.Type<typeof UserId>
//   ^? string & Brand<"UserId">

const OrgId  = Schema.String.pipe(Schema.brand("OrgId"))
type OrgId   = Schema.Schema.Type<typeof OrgId>
```

At runtime both are plain strings. At compile time TypeScript treats them as distinct — so you can't accidentally pass a `UserId` where an `OrgId` is expected. This is the cheapest way to prevent mixing IDs across domains.

## Takeaways

- One schema gives you a validator and a type.
- Use the **array form** for `Union`, `Tuple`, multi-value `Literals`.
- `optional` is about the **key**; `NullOr` is about the **value**.
- Schema arrays are `readonly`.
- Reach for `brand` whenever you have ID-like strings that shouldn't be interchangeable.
