# SRN Web

Web app for **SRN (Skill Requirement Network)** — a marketplace where businesses
and individuals post requirements, and digital or local service providers bid,
get booked, and get paid.

This is a port of the SRN React Native app to Next.js, covering all five roles:
`business`, `customer`, `digital`, `local`, `admin`. The admin panel exists as
real web pages here for the first time.

> **The database is Supabase Postgres.** SQLite is gone — there is no local
> `file:` option any more, so a fresh clone needs a connection string before it
> can run or test. Supabase is a waypoint; the intent is to move to Azure later,
> which costs a connection string *if* the target is Azure Database for
> PostgreSQL. **Read [DATABASE.md](./DATABASE.md) before touching the data
> layer or deploying.**

Migration progress and decisions live in
[WEB_MIGRATION_PLAN.md](./WEB_MIGRATION_PLAN.md) — that file is the source of
truth for what is done, what is left, and why things were decided.

### 👉 Setting this up? Start here

**[Connecting real services — what this needs from you](#connecting-real-services--what-this-needs-from-you)**
is the complete list of credentials, code and decisions required to run this for
real, split by which of those three it actually is. Nothing on that list is
guessed — every file path and variable name is checked against the source.

---

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4, Neumorphic design system — **web no longer tracks the mobile palette** |
| Auth | Pluggable provider — Firebase Auth, or a working mock for local development |
| Data | Gateway → services → repository interfaces → Prisma 6 → **Supabase Postgres** |
| Storage | Pluggable provider — Supabase Storage, or local disk for development |
| Backend | API gateway over Next.js Route Handlers (single deployable unit) |
| Payments | Pluggable provider — Razorpay in production, working mock locally |
| Package manager | pnpm, pinned in `package.json` → `packageManager` |

---

## Running it locally

### 1. Prerequisites

- Node.js 20+
- pnpm — the version is pinned in `package.json` under `packageManager`, and
  CI and Vercel both read it from there. Run `corepack enable` and pnpm will
  match it automatically.
- A Postgres database. There is no local `file:` fallback any more.

### 2. Install

```bash
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env.local
```

Then fill it in. Every variable is documented in `.env.example`. The two you
cannot skip:

**Firebase Auth** — sign-in does not work without both halves.

- `NEXT_PUBLIC_FIREBASE_*` — Firebase Console → Project settings → Your apps →
  Web app → SDK setup and configuration. These are public by design.
- `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` —
  Project settings → Service accounts → **Generate new private key**. These are
  secrets. Keep the `\n` escapes in the private key exactly as downloaded; the
  code unescapes them.

Also add `localhost` under Firebase Auth → Settings → **Authorized domains**, or
the Google sign-in popup is rejected.

**Database** — three connection strings, all required. There is no zero-setup
local option: SQLite is gone, so a fresh clone cannot run or test without them.

| Variable | Port | Used for |
|---|---|---|
| `DATABASE_URL` | 6543 | Every request. Needs `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | 5432 | Migrations only. `prisma migrate` fails with P1012 without it |
| `TEST_DATABASE_URL` | 5432 | `pnpm test`, with a dedicated `?schema=srn_test` |

`?pgbouncer=true` is not optional — transaction-mode pooling cannot hold
prepared statements, and without the flag Prisma fails intermittently under
concurrency and never in single-user testing. `TEST_DATABASE_URL` must name a
schema other than `public`: the suite empties every table before each test, and
`tests/global-setup.ts` refuses to run without it.

### 4. Create and seed the database

```bash
pnpm db:deploy       # apply migrations — use this, not db:migrate
SEED_ALLOW_DESTRUCTIVE=1 pnpm db:seed
```

`db:migrate` is `prisma migrate dev`, which is interactive and fails in a
non-interactive shell. The seed now refuses every URL unless you set the flag:
with Postgres there is no "obviously local" database to detect, so it makes you
say which one you mean to wipe.

The seed creates 9 users, 4 requirements, 5 quotes, 5 bookings, a message
thread, an open dispute, a pending KYC queue, and feature flags — enough to
exercise every screen.

> **The seed's user ids are not real Firebase uids.** Signing in with a real
> account creates a *separate* profile. To exercise a seeded role end to end,
> sign in once and then change your own row's `role` in the database. See
> [DATABASE.md](./DATABASE.md) §5.

### 5. Run

```bash
pnpm dev
```

http://localhost:3000 — you'll be redirected to `/login`.

**Signing in during development:** the mock auth provider accepts any email and
checks no password, so use one of the seeded addresses (`arjun@dev.test`,
`meera@example.test`, `admin@srn.test`) or any address you like. The login screen
says so plainly, so nobody mistakes it for real authentication.

Note the seeded rows use `seed-*` ids, so signing in as `arjun@dev.test` creates
a *separate* profile and sends you to onboarding. To land in a seeded account,
change that row's `id` to the uid shown in the health check, or just onboard a
fresh one — the seed exists to make screens non-empty, not to be logged into.

Check http://localhost:3000/api/healthz for database and provider status.

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Production build (runs `prisma generate` first) |
| `pnpm start` | Serve the production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:migrate` | Create a migration after editing the schema. Interactive — fails in a non-interactive shell |
| `pnpm db:seed` | Wipe and re-seed. **Refuses without `SEED_ALLOW_DESTRUCTIVE=1`** |
| `pnpm db:reset` | **DROPS THE SCHEMA** at `DATABASE_URL` and re-migrates. Prompts first — do not add `--force` back |
| `pnpm db:deploy` | Apply existing migrations — use this in CI/production |
| `pnpm test` | Regression tests against the `srn_test` schema, never `public` |
| `pnpm preflight` | Check the environment is safe to deploy with |

---

## Deploying

### What still blocks a production deploy

The database and storage blockers are closed. `NODE_ENV=production pnpm
preflight` reports what is left; as of the Postgres migration that is four
things, and two of them are code rather than configuration:

| Blocker | Kind |
|---|---|
| `AUTH_PROVIDER=firebase` | config — credentials already exist |
| `PAYMENT_PROVIDER=razorpay` | config — needs Razorpay keys |
| `OTP_PROVIDER` | **code** — `SmsOtpProvider` is a stub that throws |
| `EMAIL_PROVIDER` | **code** — `SmtpEmailProvider` is a stub that throws |

No value of those last two makes them work. They need implementing.

Set in the hosting platform's environment settings, not a file:
`DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_APP_URL` (the real https origin — it
backs the CSRF origin check, and a wrong value 403s every mutation while
preflight still passes it), `TRUSTED_PROXY_COUNT=1`, and the Supabase Storage
trio.

### Check before you deploy

```bash
NODE_ENV=production pnpm preflight
```

Exits non-zero on anything that would break silently — a development auth or
payment provider, local file storage, a pooled connection string missing
`pgbouncer=true`, a storage provider selected without its credentials. Every one
of those looks like a working deployment for a while and then loses data or
authenticates the wrong person, which is why they are checked rather than
trusted.

`/api/healthz` runs the same checks and returns 503 if any are fatal, so a
platform health check catches a misconfiguration even if nobody ran preflight.

### Deploying to Vercel

1. Import the repository in Vercel.
2. Set **every** variable from `.env.example` in Project Settings →
   Environment Variables. Nothing required to run the app is hardcoded, so a
   missing variable means a broken deploy.
   - `DATABASE_URL` — the **pooled** string (`:6543`) with
     `?pgbouncer=true&connection_limit=1`. Without the flag Prisma emits
     prepared statements the pooler cannot hold, and it fails only under
     concurrent load.
   - `DIRECT_URL` — the **session** string (`:5432`). The app never reads it,
     but `prisma migrate` fails with P1012 if it is absent.
   - `NEXT_PUBLIC_APP_URL` must be the real deployed origin — it backs the CSRF
     origin check, so a wrong value 403s every mutation. **Preflight does not
     catch this**: it only checks the variable is non-empty, so `localhost`
     passes while breaking the whole app.
3. Add your deployed domain to Firebase Auth → Settings → Authorized domains,
   or sign-in fails in production.
4. Run migrations against the production database:
   ```bash
   pnpm db:deploy    # uses DIRECT_URL, not the pooled one
   ```
   Do **not** run `pnpm db:seed` against production — it wipes every table.
5. Verify `https://<your-domain>/api/healthz` returns `"status": "ok"` with
   `"database": "up"`.

The app is a single deployable unit — there is no separate backend service to
deploy.

### Security headers

Set in `next.config.ts`: HSTS, `X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy`, `Permissions-Policy`. HTTPS is assumed in production —
session cookies are `secure` when `NODE_ENV=production`.

A Content-Security-Policy is **not** set yet. It lands with the Razorpay
integration, because Checkout injects a script and an iframe and a wrong policy
silently breaks payments.

---

## Connecting real services — what this needs from you

**The app runs today with no third-party accounts.** Every screen works against
local implementations, so the product can be built and demonstrated before any
vendor exists.

What follows is the complete list of what has to come from you. It is split by
the kind of work involved, because that distinction is the whole point: some of
these are a paste-in, some need code written, and some are decisions nobody but
you can make.

> Full narrative version, including the reasoning behind each deferral, is in
> [HANDOVER.md](HANDOVER.md).

### Where the values go

One file, `.env.local` in the repo root. It is gitignored — never commit it.

```bash
cp .env.example .env.local     # then fill it in
```

On a host (Vercel, Railway, Fly), the same names go in that platform's
environment settings rather than a file.

---

### Tier 1 — credentials only

These are fully implemented. Paste the values and they work; there is no code
to write.

| Service | Variables to set | Implementation |
|---|---|---|
| **Firebase Auth** | `AUTH_PROVIDER=firebase`, `NEXT_PUBLIC_AUTH_PROVIDER=firebase`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and the six `NEXT_PUBLIC_FIREBASE_*` client keys | `src/lib/providers/auth/firebase.server.ts` |
| **Razorpay** | `PAYMENT_PROVIDER=razorpay`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | `src/lib/providers/payments/index.server.ts` |

**Firebase setup:** register a *Web app* in the existing project — additive, and
it changes nothing for the mobile app — then add your domain under
Auth → Settings → Authorized domains.

**Razorpay setup:** register the webhook at
`<NEXT_PUBLIC_APP_URL>/api/v1/payments/webhook` for the `payment.captured`
event. Order amounts are always re-derived server-side from our own price list,
and a paid tier is granted **only** from a signature-verified webhook — never
from the browser claiming success.

> ⚠️ **Neither has ever been executed against a real service.** The contracts
> are identical to the mocks and the mocks are exercised by tests, but "the
> interface is satisfied" is not "Razorpay accepted the payload." Use test keys
> and watch one real transaction end to end before pointing anything at live
> money.

---

### Tier 2 — a vendor decision, then code

These three are deliberate stubs that **throw** rather than fail quietly. Each
sits beside a working mock that documents the exact contract, so implementing
one is filling in methods, not designing an interface.

| Service | File | What to implement |
|---|---|---|
| **File storage** | `src/lib/providers/storage/index.server.ts` → `FirebaseStorageProvider` | `createUploadTarget`, `getReadUrl`, `exists`, `delete`. Vars: `STORAGE_PROVIDER=firebase`, `FIREBASE_STORAGE_BUCKET` |
| **SMS / OTP** | `src/lib/providers/otp/index.server.ts` → `SmsOtpProvider` | One `send()` against Twilio / MSG91 / similar. Vars: `OTP_PROVIDER=sms`, `SMS_API_KEY`, `SMS_SENDER_ID` |
| **Email** | `src/lib/providers/email/index.server.ts` → `SmtpEmailProvider` | One `send()` against SES / Resend / Postmark. Vars: `EMAIL_PROVIDER=smtp`, `EMAIL_API_KEY`, `EMAIL_FROM` |

**Non-negotiable for storage:** `getReadUrl` must return a short-lived **signed**
URL for the `document` and `evidence` contexts. Those are KYC identity documents
and dispute evidence, not public assets. The local implementation does this, and
it is why uploads live in `.data/uploads` and **not** `public/uploads` —
anything under `public/` is served unauthenticated by Next.js at the root path,
which would put every identity document on a guessable URL.

`STORAGE_PROVIDER` accepts only `local` and `firebase`. In production any other
value resolves to `firebase` and fails loudly, rather than silently falling back
to local disk.

---

### Tier 3 — decisions only you can make

| Decision | Variable | Why it matters |
|---|---|---|
| **Database** | `DATABASE_URL` | The real blocker. SQLite does not survive serverless hosting — see [the SQLite problem](#before-you-deploy-the-sqlite-problem). Neon / Supabase / Railway Postgres, then change `provider` in `prisma/schema.prisma`. |
| **Public URL** | `NEXT_PUBLIC_APP_URL` | Backs the CSRF origin check. A wrong value breaks every mutation. |
| **Storage signing key** | `STORAGE_SIGNING_SECRET` | `openssl rand -base64 32`. Easy to miss. Left unset, every instance signs with its own random key, so a signed KYC link minted by one is rejected by the next — and all outstanding links die on each deploy. |
| **Proxy depth** | `TRUSTED_PROXY_COUNT` | `1` behind Vercel. A wrong value makes rate limiting spoofable. |
| **GDPR erasure schedule** | *(no variable)* | Deletion requests accumulate with a grace period. The erasure function is written and tested; nothing runs it. That needs a cron, which is infrastructure. |

---

### Suggested order

1. **Postgres, `NEXT_PUBLIC_APP_URL`, `STORAGE_SIGNING_SECRET`** — unblocks a
   real deployment at all.
2. **Firebase** — one project covers auth *and* storage, and the same
   registration unblocks web push later.
3. **Razorpay test keys** — the highest-risk untested path, because it is money.
4. **SMS and email** — least urgent. Both degrade visibly rather than
   dangerously: OTP codes are logged, email is logged.

### Verify before you deploy

```bash
NODE_ENV=production DATABASE_URL="<real>" pnpm preflight
```

Exits non-zero on anything that would otherwise fail silently — a development
provider in production, SQLite, a missing signing secret, and a **misspelled**
`STORAGE_PROVIDER`, which used to pass this check and then quietly write
identity documents to an ephemeral disk.

---

## The API gateway

The frontend never talks to the database. Every data operation crosses one
boundary:

```
  UI  →  gateway  →  service  →  repository  →  provider / database
```

- **Server components** call `gateway.*` from `@/lib/gateway` — in-process, no
  HTTP round trip to our own server.
- **Client components** call `callGateway(...)` from `@/lib/gateway/client`,
  which posts to `POST /api/v1/:operation`.

Both run the *same* pipeline — resolve context → rate limit → access policy →
validate input → service → audit — so the public API cannot drift from what
server rendering does. Adding an operation means adding one `defineOperation`;
it is then reachable over both transports automatically.

**This is enforced, not documented.** ESLint fails the build if UI imports a
repository, a service, Prisma, or a provider SDK directly. Try it: importing
`repo` in a page is an error with a message telling you what to use instead.

---

## Architecture notes

**The data layer is the important part.** Feature code imports `repo` from
`@/lib/repositories` and nothing else — never `PrismaClient`, never generated
Prisma types. The domain types in `src/lib/repositories/types.ts` are
hand-written so that callers do not inherit the shape of whatever database is
underneath. That isolation is what makes the eventual database swap a change to
one directory instead of the whole app.

**Auth is split deliberately.** Firebase owns *identity* (uid, email, password,
Google sign-in). Our database owns the *profile* (role, name, subscription,
everything else), keyed by the Firebase uid. The role is never read from the
token — always from our own database.

**The request filter is not a security boundary.** `src/proxy.ts` (Next 16's
replacement for `middleware`) only checks that a session cookie *exists*, and it
never runs for `/api/*` at all — so any check placed there would be absent from
every route that carries data. Real verification and role checks happen
server-side in the gateway pipeline and the authenticated layouts. An ESLint
rule restricts what `proxy.ts` may import, so this stays true.

**Chat is REST polling, not realtime.** This matches the mobile app, which
despite appearances does not use Firestore listeners. The reasoning and evidence
are in [WEB_MIGRATION_PLAN.md](./WEB_MIGRATION_PLAN.md) §0.1.

---

## Relationship to the mobile app

This is a **standalone repository**. It does not import from the mobile repo, and
it does not call the mobile app's Express backend or its Firestore database —
behaviour was ported, not shared.

The one intentional overlap is Firebase **Auth**, so a person has one identity
across both apps. That requires registering a Web app in the existing Firebase
project, which is additive and changes nothing for mobile.
