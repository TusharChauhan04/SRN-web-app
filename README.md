# SRN Web

Web app for **SRN (Skill Requirement Network)** — a marketplace where businesses
and individuals post requirements, and digital or local service providers bid,
get booked, and get paid.

This is a port of the SRN React Native app to Next.js, covering all five roles:
`business`, `customer`, `digital`, `local`, `admin`. The admin panel exists as
real web pages here for the first time.

> **The production database has not been chosen yet.** The data layer is built
> behind a repository abstraction with a Prisma/SQLite placeholder so the real
> one can be connected later without a rewrite. **Read [DATABASE.md](./DATABASE.md)
> before touching the data layer or deploying.**

Migration progress and decisions live in
[WEB_MIGRATION_PLAN.md](./WEB_MIGRATION_PLAN.md) — that file is the source of
truth for what is done, what is left, and why things were decided.

---

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS 4, design tokens ported from the mobile app |
| Auth | Pluggable provider — Firebase Auth in production, working mock locally |
| Data | Gateway → services → repository interfaces → Prisma 6 → SQLite *(placeholder)* |
| Backend | API gateway over Next.js Route Handlers (single deployable unit) |
| Payments | Pluggable provider — Razorpay in production, working mock locally |
| Package manager | pnpm 9 |

---

## Running it locally

### 1. Prerequisites

- Node.js 20+
- pnpm 9 (`npm install -g pnpm@9`)

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

**Database** — `DATABASE_URL` defaults to `file:./dev.db` and needs no setup for
local development.

### 4. Create and seed the database

```bash
pnpm db:migrate      # applies migrations, creates prisma/dev.db
pnpm db:seed         # realistic sample data across all 5 roles
```

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
| `pnpm db:migrate` | Create + apply a migration after editing the schema |
| `pnpm db:seed` | Wipe and re-seed **(destructive)** |
| `pnpm db:reset` | Drop, re-migrate, re-seed **(destructive)** |
| `pnpm db:deploy` | Apply existing migrations — use this in CI/production |
| `pnpm test` | Regression tests against a scratch database |
| `pnpm preflight` | Check the environment is safe to deploy with |

---

## Deploying

### Before you deploy: the SQLite problem

**SQLite does not work on serverless hosting.** Vercel's filesystem is ephemeral
and read-only at runtime — a SQLite file written there is lost on every cold
start and is not shared between instances. This will not fail loudly; it will
silently lose data.

So the first deployment needs one of:

- **Move the placeholder to hosted Postgres** (Neon, Supabase, Vercel Postgres).
  This is the Case A procedure in [DATABASE.md](./DATABASE.md) §3 and can happen
  *before* the real database decision is made. **Recommended.**
- **Deploy somewhere with a persistent disk** (Railway, Fly.io, a VM), which
  keeps SQLite viable but only for a single instance.

### Check before you deploy

```bash
NODE_ENV=production DATABASE_URL="<real url>" pnpm preflight
```

Exits non-zero on anything that would break silently — SQLite in production, a
development auth or payment provider, local file storage, a missing
`NEXT_PUBLIC_APP_URL`. Every one of those looks like a working deployment for a
while and then loses data or authenticates the wrong person, which is exactly
why they are checked rather than trusted.

`/api/healthz` runs the same checks and returns 503 if any are fatal, so a
platform health check catches a misconfiguration even if nobody ran preflight.

### Deploying to Vercel

1. Import the repository in Vercel.
2. Set **every** variable from `.env.example` in Project Settings →
   Environment Variables. Nothing required to run the app is hardcoded, so a
   missing variable means a broken deploy.
   - `DATABASE_URL` must point at your hosted database, not `file:./dev.db`.
   - `NEXT_PUBLIC_APP_URL` must be the real deployed origin — Razorpay webhooks
     and share links use it.
3. Add your deployed domain to Firebase Auth → Settings → Authorized domains,
   or sign-in fails in production.
4. Run migrations against the production database:
   ```bash
   DATABASE_URL="<production url>" pnpm db:deploy
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

## Connecting real services

**The app runs with no third-party accounts.** Auth and payments both ship with
working local implementations, so the whole product can be built and used before
Firebase or Razorpay exist. Neither is a stub — the mock providers sign and
verify real credentials and real webhook signatures, so the code paths you rely
on in production are the ones exercised in development.

Both mock providers **refuse to start when `NODE_ENV=production`**, so a
half-configured deploy fails loudly instead of authenticating strangers or
granting paid plans for free.

### Connecting Firebase Auth

1. Register a **Web app** in the Firebase project (additive; changes nothing for
   the mobile app).
2. Fill `NEXT_PUBLIC_FIREBASE_*` and the three `FIREBASE_*` service-account vars.
3. Set `AUTH_PROVIDER=firebase` and `NEXT_PUBLIC_AUTH_PROVIDER=firebase`.
4. Add your domain under Firebase Auth → Settings → Authorized domains.

No application code changes. Everything speaks `AuthServerProvider` /
`AuthClientProvider`; only `src/lib/providers/auth/` knows Firebase exists.

### Connecting Razorpay

1. Fill `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
   `RAZORPAY_WEBHOOK_SECRET`.
2. Set `PAYMENT_PROVIDER=razorpay`.
3. Register the webhook at `<NEXT_PUBLIC_APP_URL>/api/v1/payments/webhook` for
   the `payment.captured` event.

Order amounts are always re-derived server-side from our own price list, and a
paid tier is granted **only** from a signature-verified webhook — never from the
browser claiming success.

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
