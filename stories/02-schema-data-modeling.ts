/**
 * 02 — Schema data modeling.
 *
 * Schema is Effect's codec/validator library. A `Schema<T>` value is both:
 *   - a runtime validator (`decodeUnknownSync(schema)(input)`)
 *   - a TypeScript type (`Schema.Schema.Type<typeof schema>`)
 *
 * v4 tightened the API — notice the **array** form for `Union`, `Tuple`, and
 * the **array** form for multi-value `Literals` (singular `Literal` stays
 * for single-value). See EFFECT_V4_MIGRATION.md §3.
 *
 * Run: `bun stories/02-schema-data-modeling.ts`
 * Real-world reference: `tbiz_ts/packages/schema/src/trip.ts`, `hotel.ts`
 */

import { Schema } from "effect";

/* ---------- 1. Struct — the canonical product type ----------------------- */

const Price = Schema.Struct({
  amount: Schema.Number,
  currency: Schema.String,
});
type Price = Schema.Schema.Type<typeof Price>;
//   ^?  { readonly amount: number; readonly currency: string }

console.log("1) Price type derived from schema — sample:", {
  amount: 100,
  currency: "IDR",
} satisfies Price);

/* ---------- 2. Literals (multi) vs Literal (single) ---------------------- *
 * v3's variadic `Schema.Literal("a","b","c")` became `Schema.Literals([..])`.
 * This trips a lot of people migrating. Single-value `Schema.Literal("x")`
 * is unchanged.
 */

const TripPurpose = Schema.Literals(["DINAS", "TRAINING", "CONFERENCE", "OTHER"]);
type TripPurpose = Schema.Schema.Type<typeof TripPurpose>;
//   ^? "DINAS" | "TRAINING" | "CONFERENCE" | "OTHER"

const JsonRpcVersion = Schema.Literal("2.0"); // single value — old API stays
type JsonRpcVersion = Schema.Schema.Type<typeof JsonRpcVersion>;
//   ^? "2.0"

/* ---------- 3. Union / Tuple / Record — all **array** form in v4 --------- */

const Id = Schema.Union([Schema.String, Schema.Number]); // not Union(A, B)
type Id = Schema.Schema.Type<typeof Id>;

const Coord = Schema.Tuple([Schema.Number, Schema.Number]); // not Tuple(A, B)
type Coord = Schema.Schema.Type<typeof Coord>;
//   ^? readonly [number, number]

// Record takes positional (key, value) args in v4
const Env = Schema.Record(Schema.String, Schema.String);
type Env = Schema.Schema.Type<typeof Env>;

/* ---------- 4. Optional fields ------------------------------------------- *
 * `Schema.optional(X)` makes a field undefined-able. For a **default value**,
 * see story 03 (withDecodingDefault).
 */

const TripPax = Schema.Struct({
  id: Schema.String,
  title: Schema.Literals(["Mr", "Mrs", "Ms"]),
  firstName: Schema.String,
  lastName: Schema.String,
  // optional fields
  idType: Schema.optional(Schema.Literals(["KTP", "PASSPORT"])),
  phone: Schema.optional(Schema.String),
});

/* ---------- 5. NullOr vs optional ---------------------------------------- *
 * `NullOr(X)` allows `null`; `optional(X)` allows the key to be missing.
 * APIs often use both independently: `holderEmail: Schema.NullOr(Schema.String)`.
 */

const HolderContact = Schema.Struct({
  email: Schema.NullOr(Schema.String),            // null allowed, field required
  phone: Schema.optional(Schema.NullOr(Schema.String)), // null OR missing
});

/* ---------- 6. Arrays (readonly!) ---------------------------------------- *
 * `Schema.Array(X)` produces a **readonly** array type. Component props
 * consuming schema-derived data must type params as `readonly T[]`.
 */

const Passengers = Schema.Array(TripPax);
type Passengers = Schema.Schema.Type<typeof Passengers>;
//   ^? readonly TripPax[]

/* ---------- 7. Brands — type-safe opaque strings/numbers ----------------- */

const UserId = Schema.String.pipe(Schema.brand("UserId"));
type UserId = Schema.Schema.Type<typeof UserId>;
//   ^? string & Brand<"UserId">

const OrgId = Schema.String.pipe(Schema.brand("OrgId"));
type OrgId = Schema.Schema.Type<typeof OrgId>;

// UserId and OrgId are NOT assignable to each other at compile time,
// despite both being `string` at runtime.

/* ---------- 8. Composing — the tbiz_ts Trip schema (simplified) ---------- */

const Trip = Schema.Struct({
  id: UserId,
  title: Schema.String,
  purpose: TripPurpose,
  departureDate: Schema.String,
  passengers: Passengers,
  estimatedBudget: Schema.optional(Schema.Number),
  currency: Schema.String,
});
type Trip = Schema.Schema.Type<typeof Trip>;

const sampleTrip: Trip = {
  id: "user-1" as UserId,
  title: "Jakarta → Tokyo",
  purpose: "DINAS",
  departureDate: "2026-05-01",
  passengers: [
    { id: "p1", title: "Mr", firstName: "Ridho", lastName: "R" },
  ],
  currency: "IDR",
};

console.log("8) Sample trip:", sampleTrip);

/* ---------- Key takeaways ------------------------------------------------- *
 *  Struct  → product type
 *  Literals([...])  (array)  — NOT `Literal("a","b")`
 *  Union([...])     (array)
 *  Tuple([...])     (array)
 *  Record(K, V)     (positional)
 *  optional(X)      — key may be missing
 *  NullOr(X)        — value may be null
 *  Array(X)         — readonly
 *  brand("Name")    — nominal types
 */
