# Database

**Status: the production database for this app has not been chosen.**

Everything here is built so that decision can be made later without a rewrite.
Read this file before touching the data layer, and before wiring up a real
database.

---

## 1. The shape of it

```
  pages / components / route handlers
              │
              │  imports ONLY this
              ▼
   src/lib/repositories/index.ts        ← the swap point (one object literal)
              │
              ▼
   src/lib/repositories/interfaces.ts   ← 21 interfaces, ~130 methods
              │
              ▼
   src/lib/repositories/prisma/*.ts     ← the ONLY code that knows about SQL
              │
              ▼
   src/lib/db/client.ts  →  @prisma/client  →  SQLite (PLACEHOLDER)
```

**The rule:** no page, component, or Route Handler imports `PrismaClient`, the
generated Prisma types, or anything under `prisma/`. They import `repo` from
`@/lib/repositories` and speak the domain types in
`src/lib/repositories/types.ts`. Those domain types are hand-written, not
Prisma-generated, precisely so the calling code does not inherit the shape of
whatever database happens to be underneath.

If you find yourself importing Prisma outside `src/lib/repositories/prisma/`,
that's the abstraction leaking — fix it there rather than at the call site.

---

## 2. What's currently backing it

| Piece | Current | Why |
|---|---|---|
| ORM | Prisma 6 | Datasource provider is swappable by config, so Postgres/MySQL is a small change. Pinned to 6 deliberately — Prisma 7 moves the connection URL out of the schema and requires driver adapters, which adds moving parts for no benefit here. |
| Database | SQLite (`prisma/dev.db`) | Zero-setup local development. **Not viable in production** — see §5. |
| Migrations | `prisma/migrations/` | Real migration history, not `db push`. Treated with the same rigour as a production database. |
| Seed | `prisma/seed.ts` | 9 users across all 5 roles + every major entity. |

### SQLite compromises encoded in the schema

These exist because SQLite lacks the types, and they are all isolated in
`src/lib/repositories/prisma/mappers.ts`:

Mapper inputs are typed against the generated Prisma models, so the compiler
catches a column rename. The conversions below are what the mappers exist to
do; the types make sure they are converting a field that still exists.

| Want | SQLite has | Workaround | On Postgres |
|---|---|---|---|
| `string[]` (skills, privileges, evidence URLs) | no array type | comma-joined `String`, split in mappers | native `String[]`, drop the splitting |
| `Json` (notification data, audit metadata) | no JSON type | `String` holding JSON, parsed in mappers | native `Json` |
| enums (role, status) | no enums | `String` + Zod validation at the edge | native enums |
| case-insensitive search | no `mode: "insensitive"` | plain `contains` (case-sensitive) | add `mode: "insensitive"` |

The last one is a **real behavioural difference**: provider search is currently
case-sensitive. On a real database this becomes correct by adding one option.

---

## 3. Connecting a real database

### Case A — the choice is Postgres or MySQL (most likely)

This is the small change the abstraction was designed for.

1. **Swap the datasource** in `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"   // was "sqlite"
     url      = env("DATABASE_URL")
   }
   ```

2. **Set `DATABASE_URL`** in your environment (and in the hosting platform's
   env settings):
   ```
   DATABASE_URL="postgresql://user:password@host:5432/srn?schema=public"
   ```

3. **Upgrade the types SQLite forced into strings.** Optional, but do it now
   rather than living with the workarounds:
   - `skills`, `portfolioLinks`, `privileges`, `evidenceUrls`, `docUrls`,
     `participantIds` → `String[]`
   - `Notification.data`, `AuditEvent.metadata` → `Json`
   - `role`, `status` fields → Prisma `enum`s
   Then simplify `mappers.ts` accordingly — `splitList`/`joinList`/`parseJson`
   become pass-throughs and can be deleted.

4. **Add case-insensitive search** in `prisma/users.ts` (`textFilter`) and
   `prisma/marketplace.ts` (requirement search): add `mode: "insensitive"` to
   each `contains`.

5. **Reset the migration history.** The existing migration is SQLite DDL and
   will not apply to Postgres:
   ```bash
   rm -rf prisma/migrations
   pnpm prisma migrate dev --name init
   ```
   (If any production data already exists, write a real migration instead of
   deleting history.)

6. **Deploy migrations** in the target environment:
   ```bash
   pnpm db:deploy      # prisma migrate deploy
   ```

7. **Decide what happens to the seed.** `prisma/seed.ts` is development
   fixture data with fake user ids. Either re-point it at a staging database
   only, or retire it — do not run it against production.

8. **Verify:** `curl /api/healthz` should report `"database": "up"`.

Nothing under `src/app/` or `src/components/` changes in this path.

### Case B — the choice is not SQL (document store, or a vendor SDK)

The repository interfaces still do their job; only the implementations change —
**with one caveat that is not free.**

> **`Page<T>` assumes offset pagination.** It requires `total` and `offset`
> (`src/lib/repositories/types.ts`), which MongoDB can satisfy
> (`skip`/`limit`/`countDocuments`) but **Firestore and DynamoDB cannot** —
> DynamoDB has no offset at all, only cursors, and neither offers a cheap
> filtered total. Picking one of those means changing `Page<T>` and every list
> signature that returns it (16 methods) plus their call sites.
>
> Making `total` optional and adding an optional cursor to `PageParams` now
> costs about an hour and removes this constraint. Worth doing before the
> screen count grows.

1. Create `src/lib/repositories/<vendor>/` alongside `prisma/`.
2. Implement each interface from `src/lib/repositories/interfaces.ts`. The
   interfaces are the contract — the method list and return types are what the
   app depends on, and the domain types in `types.ts` do not change.
3. Swap the object literal in `src/lib/repositories/index.ts`:
   ```ts
   export const repositories: Repositories = {
     users: new MongoUserRepository(),
     // …
   };
   ```
4. Delete `src/lib/repositories/prisma/` and the Prisma dependencies once
   nothing references them.

Again: no page, component, or Route Handler changes.

---

## 4. Everyday commands

```bash
pnpm db:migrate      # create + apply a migration after editing schema.prisma
pnpm db:generate     # regenerate the Prisma client
pnpm db:seed         # wipe and re-seed (destructive)
pnpm db:reset        # drop, re-migrate, re-seed
pnpm db:deploy       # apply existing migrations (use in CI/production)
```

After **any** schema change: run `pnpm db:migrate`, then `pnpm typecheck`, then
`pnpm db:seed`.

> **`typecheck` now catches mapper drift.** `mappers.ts` types each row against
> the generated Prisma model, with `include`d relations declared explicitly, so
> renaming a column fails the build at the mapper rather than silently returning
> `undefined`. Verified by injecting a rename and confirming it errors.
>
> Note what did NOT work, since it looks correct: typing rows as
> `PrismaModel & Record<string, unknown>` to allow relations through. The index
> signature makes every property access legal, so drift still typechecked. If
> you add a mapper, name its relations — do not reach for a catch-all.
>
> The seed remains a second line of defence for anything types cannot express.

---

## 5. Known constraints and gaps

Recorded so they are decisions, not surprises.

**SQLite does not work on serverless hosting.** Vercel's filesystem is
ephemeral and read-only at runtime; a SQLite file written there is lost on
every cold start and not shared between instances. Before the first real
deployment, either:
- move the placeholder to a small hosted Postgres (Neon / Supabase / Vercel
  Postgres) — this is just Case A above and can happen *before* the real
  database decision lands, or
- deploy somewhere with a persistent disk (Railway, Fly, a VM).

This is the single biggest thing riding on the placeholder.

**Rate limiting is database-backed.** `RateLimitRepository` writes to the same
store. That's fine for a single instance but is not a substitute for an
edge/Redis limiter under real traffic, and it puts write load on the database
on every request. Revisit when the real database is chosen.

**Fraud detection is heuristic, not signal-based.**
`UserRepository.findSuspiciousAccounts` looks for new accounts with improbable
review counts, because the schema carries no device/IP fingerprint. The mobile
backend had the same limitation. If real fraud detection is wanted, the schema
needs signup IP/device columns first.

**`Conversation.participantIds` assumes 1:1 threads.** It's a sorted
comma-joined pair used as a lookup key. Group chat would need a proper join
table. Mobile is 1:1 only, so this matches parity.

**Counters are denormalised.** `User.rating`, `reviewsCount`,
`completedGigs`, `postedRequirementsCount` are maintained by the repositories
on write. They can drift if rows are modified outside the repository layer —
another reason for the no-direct-Prisma rule.
`ReviewRepository.recomputeSubjectRating` is the repair path for ratings.

**Some constraints are enforced by the database, not only by code.** These are
the ones a swap must preserve, because the application relies on the violation
being raised:

| Constraint | Why it exists | Code that depends on it |
|---|---|---|
| `User.phone` unique | One phone number, one account. Without it a single number verifies unlimited accounts, the verified badge is meaningless, and a suspended user has a route back in. | `UserRepository.update` translates `P2002` into a conflict |
| `Quote(requirementId, senderId)` unique | One live bid per provider per requirement. The service checks first, but check-then-insert is not atomic — a double-clicked submit inserts twice. | `QuoteRepository.create` translates `P2002` |
| `SubscriptionOrder.id` primary key + conditional settle | The atomic gate that makes a duplicate payment webhook safe. | `activateFromPayment` claims via `updateMany ... where razorpayPaymentId: null` |
| `Conversation.participantIds` unique | Two people opening a thread simultaneously get one thread, not two. | `MessageRepository.send` catches the create failure |

If you move to Postgres these all carry over unchanged. If you move to a store
without unique constraints (most document databases), **the guards above stop
working silently** — the `P2002` translation simply never fires, and the races
come back. That is the single most important thing to check when swapping.

**Seeded user ids are not Firebase uids.** Firebase Auth owns identity; the
`User.id` column is the Firebase uid for real accounts. Seeded rows use
`seed-*` ids, so signing in with a real Google account creates a *separate*
profile. To exercise a seeded role end-to-end, sign in once, then update your
own row's `role` in the database (or change a seed id to your uid and re-seed).