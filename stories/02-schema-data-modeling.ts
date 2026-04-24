/**
 * 02 — Schema data modeling.
 *
 * Schema is Effect's codec/validator library. One schema gives you:
 *   - a runtime validator (`decodeUnknownSync(schema)(input)`)
 *   - a TypeScript type (`typeof schema.Type`)
 *   - JSON serialization
 *
 * The effect-solutions recommendation: reach for **Schema.Class** for
 * composite records (you can hang methods off them), **Schema.TaggedClass**
 * for tagged variants, and brand **nearly every** domain primitive — not
 * just IDs, but emails, ports, URLs, percentages, etc.
 *
 * v4 trap: `Union`, `Tuple`, and multi-value `Literals` all take **array
 * form** now — trips every v3 port. See EFFECT_V4_MIGRATION.md §3.
 *
 * Run: `bun stories/02-schema-data-modeling.ts`
 * Real-world reference: `tbiz_ts/packages/schema/src/trip.ts`, `hotel.ts`
 */

import { Effect, Match, Schema } from "effect";

/* ---------- 1. Brand nearly every primitive ------------------------------ *
 * Branded types prevent you from mixing values that look identical at the
 * type level but carry different meaning. In a healthy domain model you'll
 * have dozens of these.
 */

export const UserId = Schema.String.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const PostId = Schema.String.pipe(Schema.brand("PostId"));
export type PostId = typeof PostId.Type;

export const Email = Schema.String.pipe(
  Schema.check(Schema.isPattern(/.+@.+\..+/, { message: "invalid email" })),
  Schema.brand("Email"),
);
export type Email = typeof Email.Type;

export const Port = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  Schema.brand("Port"),
);
export type Port = typeof Port.Type;

// Construct branded values by decoding — this runs the checks + brands in
// one step. (Later betas add `Schema.make`/`makeUnsafe` constructors on
// branded schemas; in beta.57 decode is the portable path.)
const u1: UserId = Schema.decodeUnknownSync(UserId)("user-123");
const p1: Port = Schema.decodeUnknownSync(Port)(8080);
console.log("1) branded:", { u1, p1 });

/* ---------- 2. Schema.Class — records with methods ----------------------- *
 * Unlike Schema.Struct (anonymous record), Schema.Class gives you a real
 * class you can extend with getters and methods. Recommended default for
 * composite domain types.
 */

class User extends Schema.Class<User>("User")({
  id: UserId,
  name: Schema.String,
  email: Email,
  // `Schema.Date` is an instance-of check — expects a real Date at the Type
  // level. For API payloads (ISO strings) you'd typically use `Schema.String`
  // or a string→Date codec; we use an ISO string here for JSON-friendliness.
  createdAt: Schema.String,
}) {
  // Instance methods — just like a regular class
  get displayName() {
    return `${this.name} <${this.email}>`;
  }
}

const alice = new User({
  id: Schema.decodeUnknownSync(UserId)("u-1"),
  name: "Alice",
  email: Schema.decodeUnknownSync(Email)("alice@example.com"),
  createdAt: new Date().toISOString(),
});
console.log("2) User class:", alice.displayName);

/* ---------- 3. Schema.TaggedClass — structured variants ------------------ *
 * For sum types ("Result is Success OR Failure"), pair Schema.TaggedClass
 * with Schema.Union. Each variant gets a literal `_tag` so pattern
 * matching stays exhaustive.
 */

class PaymentSucceeded extends Schema.TaggedClass<PaymentSucceeded>("PaymentSucceeded")(
  "PaymentSucceeded",
  { transactionId: Schema.String, amount: Schema.Number },
) {}

class PaymentFailed extends Schema.TaggedClass<PaymentFailed>("PaymentFailed")(
  "PaymentFailed",
  { reason: Schema.String, retryable: Schema.Boolean },
) {}

const PaymentResult = Schema.Union([PaymentSucceeded, PaymentFailed]);
type PaymentResult = typeof PaymentResult.Type;

// Match.valueTags — exhaustive pattern match keyed on `_tag`.
const describe = (r: PaymentResult) =>
  Match.valueTags(r, {
    PaymentSucceeded: ({ transactionId, amount }) => `OK ${transactionId} ($${amount})`,
    PaymentFailed: ({ reason, retryable }) =>
      retryable ? `retry: ${reason}` : `abort: ${reason}`,
  });

console.log("3a)", describe(new PaymentSucceeded({ transactionId: "tx-1", amount: 42 })));
console.log("3b)", describe(new PaymentFailed({ reason: "declined", retryable: false })));

/* ---------- 4. The v4 primitives you'll hit most ------------------------- */

const TripPurpose = Schema.Literals([
  "DINAS",
  "TRAINING",
  "CONFERENCE",
  "OTHER",
]); // multi-value → array form
const JsonRpcVersion = Schema.Literal("2.0"); // single → unchanged
type TripPurpose = typeof TripPurpose.Type;

const Id = Schema.Union([Schema.String, Schema.Number]); // Union → array form
const Coord = Schema.Tuple([Schema.Number, Schema.Number]); // Tuple → array form
const Env = Schema.Record(Schema.String, Schema.String); // Record → (K, V)
void JsonRpcVersion; void Id; void Coord; void Env;

/* ---------- 5. optional vs NullOr, readonly arrays ----------------------- */

const Contact = Schema.Struct({
  email: Schema.NullOr(Email),                       // null allowed, key required
  phone: Schema.optional(Schema.NullOr(Schema.String)), // null OR missing
});

const Passengers = Schema.Array(User);
// ^? readonly User[]  — component props consuming this must use `readonly`
void Contact; void Passengers;

/* ---------- 6. Composing — a small domain model -------------------------- */

class Trip extends Schema.Class<Trip>("Trip")({
  id: UserId,                 // (re-using UserId for brevity — would be a real brand)
  title: Schema.String,
  purpose: TripPurpose,
  departureDate: Schema.String,
  passengers: Passengers,
  currency: Schema.String,
}) {}

const trip = new Trip({
  id: Schema.decodeUnknownSync(UserId)("u-1"),
  title: "Jakarta → Tokyo",
  purpose: "DINAS",
  departureDate: "2026-05-01",
  passengers: [alice],
  currency: "IDR",
});
console.log("6) trip title:", trip.title, "| passengers:", trip.passengers.length);

/* ---------- 7. JSON in one step with Schema.fromJsonString --------------- *
 * Combines `JSON.parse` + decode (or `JSON.stringify` + encode) into a
 * single Schema — the *codec* approach rather than parse-then-decode.
 */

const UserFromJson = Schema.fromJsonString(User);

const decoded = await Effect.runPromise(
  Schema.decodeUnknownEffect(UserFromJson)(
    JSON.stringify({
      id: "u-2",
      name: "Bob",
      email: "bob@example.com",
      createdAt: new Date().toISOString(),
    }),
  ),
);
console.log("7) fromJsonString decoded:", decoded.displayName);

/* ---------- Key takeaways ------------------------------------------------- *
 *  Schema.Class<Self>("Name")({...})       — records w/ methods (default)
 *  Schema.TaggedClass<Self>("Tag")("Tag", {...})  — tagged variants
 *  Schema.Union([V1, V2])                  — sum of tagged classes
 *  Match.valueTags(value, {Tag: ...})      — exhaustive pattern match
 *  Schema.brand("Name")                    — brand every domain primitive
 *  Schema.fromJsonString(S)                — JSON codec in one step
 *  Array-form: Union([]), Tuple([]), Literals([]) — v4 surprise
 *  optional → key; NullOr → value
 *  Schema.Array(X) → readonly T[]
 */
