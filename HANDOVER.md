# Handover — what this needs from you

Everything below is a decision or a credential. None of it is code: every
integration sits behind a finished interface, so connecting one is a config
switch plus keys.

Ordered by what blocks what.

---

## 1. Hosting and the database — ✅ DONE

**Supabase Postgres, migrated and verified 8 Aug 2026.** This was the item that
blocked everything; it no longer does.

What was done: datasource swapped, migration history regenerated for Postgres,
all 10 unique constraints confirmed present in the live database, the rate
limiter's raw SQL rewritten (it bound datetimes as integers, which Postgres
rejects), and 12 search clauses made case-insensitive (Postgres `LIKE` is
case-sensitive where SQLite's was not — without this a provider who listed
"React" was unfindable by every query, silently).

Verified end to end: 73 tests against Supabase, and `scripts/smoke.ps1` diffed
against a pre-migration baseline — all 39 route checks identical.

**Supabase is a waypoint.** The intent is Azure later. That is a connection
string *if* the target is Azure Database for PostgreSQL, and a rewrite
otherwise — see DATABASE.md for what each option costs.

**What you still need to set** in the hosting platform: `DATABASE_URL` (pooled,
`:6543`, with `?pgbouncer=true&connection_limit=3`), `DIRECT_URL` (`:5432`), and
`NEXT_PUBLIC_APP_URL` — that last one backs the CSRF origin check, and a wrong
value 403s every mutation while preflight still reports it fine.

Two viable paths:

| Option | What it means | Effort |
|---|---|---|
| **Hosted Postgres** *(recommended)* | Neon, Supabase or Vercel Postgres. Works on any serverless host. | Provider swap + connection string — `DATABASE.md` §3 Case A |
| **Persistent disk** | Railway, Fly.io, a VM. Keeps SQLite viable. | Nothing to change, but single-instance only |

**Important:** choosing Postgres now does **not** commit you to it as the final
database. The repository interfaces are the swap boundary; moving again later
changes implementations, not calling code.

**What I need from you:** which host, and a `DATABASE_URL`.

---

## 2. Firebase — unblocks real sign-in *and* web push

Sign-in currently works through a development provider that accepts any email
and checks no password. It refuses to run in production, so this must be
connected before launch.

**Steps:**
1. In the existing `skill-requirement-network` Firebase project, register a
   **Web app**. This is additive — it changes nothing for the mobile app.
2. Copy the SDK config into the `NEXT_PUBLIC_FIREBASE_*` variables.
3. Project settings → Service accounts → **Generate new private key**. Copy into
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
   (keep the `\n` escapes exactly as downloaded).
4. Set `AUTH_PROVIDER=firebase` and `NEXT_PUBLIC_AUTH_PROVIDER=firebase`.
5. Firebase Auth → Settings → **Authorized domains** → add your deployed domain
   (and `localhost` for local work), or the Google sign-in popup is rejected.

**Note:** the same registration is what would later enable web push, which is
currently deferred — see `WEB_MIGRATION_PLAN.md` §5.

---

## 3. Razorpay — subscription checkout

Payments currently run through a mock that signs and verifies real webhook
payloads but moves no money. It also refuses to run in production.

**Steps:**
1. Dashboard → Settings → API Keys. Use `rzp_test_*` keys first.
2. Set `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
3. Register a webhook at `<your-domain>/api/v1/payments/webhook` for the
   **`payment.captured`** event. Copy the signing secret into
   `RAZORPAY_WEBHOOK_SECRET`.
4. Set `PAYMENT_PROVIDER=razorpay`.

**Test with `rzp_test_*` keys before live keys.** The Razorpay code path has
never executed against the real API — only the mock has. See §6.

---

## 4. File storage — avatars, portfolio, KYC documents

Uploads currently write to the local filesystem, which has the same
ephemerality problem as SQLite and additionally loses **identity documents**.

`FirebaseStorageProvider` is deliberately stubbed with an explicit
"not implemented" error rather than a silent failure. The interface is final —
connecting a bucket means implementing three methods.

**What I need from you:** which bucket (a fresh Firebase Storage bucket is the
path of least resistance given Firebase is already in play), then
`FIREBASE_STORAGE_BUCKET`, `STORAGE_PROVIDER=firebase`, and
**`STORAGE_SIGNING_SECRET`** (`openssl rand -base64 32`).

`STORAGE_SIGNING_SECRET` is new and easy to miss. Left unset, every instance
invents its own random key at startup — which works on one dev server and fails
intermittently on any multi-instance deploy, because a signed document link
minted by one instance is rejected by the next, and every outstanding link dies
on each restart. Preflight now refuses to pass without it.

**Non-negotiable when you do:** KYC documents and dispute evidence must be
served through short-lived signed URLs, never a public bucket. The local
implementation does this, and it is the reason the upload directory is
`.data/uploads` and **not** `public/uploads` — anything under `public/` is
served unauthenticated by Next.js at the root path, which would have made every
identity document readable by URL. If you implement `FirebaseStorageProvider`,
keep that property: `getReadUrl` must return a signed, expiring URL for the
`document` and `evidence` contexts.

`STORAGE_PROVIDER` accepts only `local` and `firebase`. In production anything
else resolves to `firebase` and fails loudly, rather than quietly falling back
to local disk — a typo used to pass preflight and then write identity documents
to an ephemeral filesystem.

---

## 5. SMS and email — both stubbed, both have a working local stand-in

| Service | Current | Needed |
|---|---|---|
| **SMS** (phone verification codes) | Logs the code and shows it in the UI. Refuses production. | A vendor (Twilio, MSG91, …), then `SMS_API_KEY`, `SMS_SENDER_ID`, `OTP_PROVIDER=sms` |
| **Email** (notification delivery) | Logs the message. Refuses production. | A vendor (SES, Resend, Postmark, …), then `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_PROVIDER=smtp` |

Email is now **fatal** in preflight, not a warning. It was downgraded on the
grounds that nobody loses data; that was wrong on two counts. Notification
bodies carry personal content — message text, quote amounts, dispute details —
straight into the server log, where retention and log shipping were never
designed to hold it. And the console provider now refuses to construct under
`NODE_ENV=production`, so shipping without a vendor is a crash on the first
notification rather than a quietly undelivered email.

---

## 6. What has never been executed — read this before going live

Four provider implementations have only been reviewed, never run. They are the
highest-consequence code in the project:

- `FirebaseAuthServerProvider` — token verification, session cookies, revocation
- `RazorpayPaymentProvider` — order creation, webhook signature verification
- `FirebaseStorageProvider` — explicitly stubbed, throws
- `SmsOtpProvider` — explicitly stubbed, throws

Their mock counterparts are exercised by tests and by hand, and the *contracts*
are identical — but "the interface is satisfied" is not "Razorpay accepted the
payload."

**Do a staged rollout:** test keys first, one real transaction end to end, and
watch the webhook actually arrive before pointing anything at live money.

---

## 7. Decisions that are yours, not mine

| Question | Why it needs you |
|---|---|
| **GDPR erasure scheduler** | Deletion requests accumulate with a grace period. The erasure function is written and tested, but nothing runs it — that needs a cron or scheduled job, which is infrastructure. |
| **Data export scope** | The export deliberately excludes anyone else's identifying data (who reviewed you, who reported you, who viewed your profile). If your legal advice differs, the redaction is one function. |
| **Provider timezones** | Availability times are interpreted as UTC. Per-provider timezones need a schema field and a product decision about how to display them. Mobile has the same limitation. |
| **Commission model** | The admin revenue page separates subscription MRR (income) from booking volume (value transacted between users), because the platform takes no cut in this model. If that changes, revenue reporting changes. |

---

## 8. How to check you got it right

```bash
NODE_ENV=production DATABASE_URL="<real>" pnpm preflight
```

Exits non-zero on anything that would break silently. Then, once deployed:

```
GET /api/healthz
```

Returns 503 while any fatal misconfiguration remains, so your platform's health
check catches it even if nobody ran preflight.

The regression harness is `scripts/smoke.ps1` — 43 checks across anonymous,
provider and admin. Capture it before a risky change and diff after.
