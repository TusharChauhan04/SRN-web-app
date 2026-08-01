# SRN Web Migration Plan

**Source:** `SRN-mobile` (React Native 0.81.5, RN Firebase, react-navigation v7)
**Target:** `SRN-web-app` — Next.js App Router + TypeScript
**Status:** Phases 0–2 done. Phase 3 (customer/business flows) is next.
**Last updated:** 2026-08-01

## Resume here

**What exists and works:** production build passes clean; `/` and `/dashboard`
redirect to `/login` when signed out; `/login` renders; `/api/healthz` returns
`database: up`. Data layer is complete and seeded (`pnpm db:seed`).

**Next step:** Phase 3, starting with `/requirements/new` (post a requirement) and
`/requirements/[id]` (detail + quote list + shortlist). The dashboard already links
to both. Follow the pattern established in `(app)/dashboard/page.tsx`: server
component → `requireUser()` → `repo.*` → render. Mutations go through Server
Actions like `(auth)/onboarding/actions.ts`, or Route Handlers where a client
component needs to call them.

**Two blockers a human must clear** (see §8 at the bottom):
1. `git push` is denied — the local credential lacks write access to the repo.
   Two commits are sitting unpushed.
2. Firebase credentials are not set, so no one can actually sign in yet.

This file is the source of truth for the migration. Not the original prompt, not
anyone's memory. Update the status column as work lands. A fresh session should be
able to resume from this file alone.

---

## 0. Discovery findings that contradict the original audit

The migration brief carried an architecture audit that was explicitly flagged as
possibly stale. Three of its claims are wrong against the real codebase. These
change decisions, so they are recorded first.

### 0.1 Chat does **not** use Firestore realtime — it is REST polling

The brief assumed `onSnapshot` listeners in `ChatScreen.tsx` / `ChatListScreen.tsx`
and recommended keeping Firestore for chat.

**Actual:** there is no `onSnapshot`, no `firestore()` call, and no
`@react-native-firebase/firestore` import anywhere in `src/`. `ChatScreen.tsx`
polls REST on an interval:

- messages: `GET /api/messages/conversations/:convId/messages?limit=100` every **5s**
  (`ChatScreen.tsx:71-88`)
- presence: `GET /api/users/:id` reading `isOnline` / `lastHeartbeat` every **30s**
  (`ChatScreen.tsx:52-68`)
- read receipts: `PATCH /api/messages/conversations/:convId/read`, debounced 10s
  (`ChatScreen.tsx:92-102`)

The local interface is named `FirestoreMessage` — a vestigial name that likely
seeded the audit's mistake. The `@react-native-firebase/firestore` package is in
`package.json` but unused by app code.

**Decision: do NOT keep Firestore for chat.** There is no realtime implementation
to preserve. Porting *behavior* means porting the polling contract, which goes
through the same repository layer as everything else. This removes a whole
Firebase dependency, removes the client-writes-to-database exception, and is
strictly more faithful to mobile. Chat parity on web = same poll cadence, same
endpoints, same read-receipt debounce.

*Upgrade path, explicitly out of scope:* if realtime is wanted later, SSE or
WebSocket against the same repository layer is the natural move. Recorded so the
option isn't lost, not scheduled.

### 0.2 There are **five** roles, not three

The brief said "customer, provider (business/digital/local), and admin". The role
union is flat and each role has its **own tab navigator with different tabs**
(`src/types/roles.ts:1`):

`business | customer | digital | local | admin`

`business` and `customer` are distinct roles with different dashboards, different
tabs, and different profile fields — not two labels for one "customer" role. Web
nav must model five, not three.

### 0.3 There is no image-picker library

No `react-native-image-picker` or equivalent is in `package.json`.
`uploadService.ts` accepts a `fileUri: string` and does not source it. So there is
no native picker behavior to reproduce — a plain HTML file input is a complete
equivalent, not a downgrade.

---

## 1. Architecture decisions (Section 0 / Section 3 of the brief)

| Decision | Choice | Rationale |
|---|---|---|
| **Firebase Auth for identity** | **Keep** (brief default) | Mobile uses Firebase Auth (Google sign-in + phone). Identity and app database are separate concerns; sharing the identity provider keeps one user account across mobile and web, keyed by the same `uid`. Web SDK `firebase/auth` with `signInWithPopup`. |
| **Firestore for chat** | **Drop** (brief default overridden) | See §0.1 — mobile has no Firestore realtime to keep. Chat goes through the repository layer like every other entity. |
| **Application database** | Repository interfaces + **Prisma/SQLite** placeholder | Real DB undecided. Full detail in `DATABASE.md`. |
| **Backend** | Next.js Route Handlers in-app | Single deployable unit per brief §3.3. No separate Express service. |
| **Package manager** | **pnpm** | Mobile monorepo pins `pnpm@9.15.9` in `package.json`. |
| **Styling** | **Tailwind CSS** with ported tokens | `src/constants/colors.ts` is already a shadcn-shaped semantic token set (background/foreground/card/primary/secondary/muted/accent/destructive/border/input + radius 16, light **and** dark). Maps to CSS variables 1:1. |
| **State** | TanStack Query | Mobile already uses `@tanstack/react-query` via the generated client. Ports directly. |
| **File storage** | Deferred to Phase 4, behind a `StorageProvider` abstraction | Mobile uses presigned-URL PUT (`uploadService.ts`) against the old backend's Firebase Storage. Web needs a fresh bucket; the 3-step presign/PUT/confirm contract is preserved behind an interface so the vendor isn't hardcoded at call sites. |
| **Web push (FCM)** | **DEFERRED** — explicit, not silent | See §5. |
| **Payments** | Razorpay hosted Checkout.js | Mobile: `create-order` server-side → native SDK → **webhook verifies server-side** → client refetches status (`SubscriptionScreen.tsx:92-141`). The server-authoritative shape ports exactly; only the checkout widget changes. |

---

## 2. Design tokens to port

From `src/constants/colors.ts` — both themes, verbatim, into CSS variables.

| Token | Light | Dark |
|---|---|---|
| background | `#f8fafc` | `#0f172a` |
| foreground | `#0f172a` | `#f8fafc` |
| card | `#ffffff` | `#1e293b` |
| cardForeground | `#0f172a` | `#f8fafc` |
| primary | `#7c3aed` | `#a78bfa` |
| primaryForeground | `#ffffff` | `#0f172a` |
| secondary | `#1e293b` | `#f1f5f9` |
| secondaryForeground | `#ffffff` | `#0f172a` |
| muted | `#f1f5f9` | `#1e293b` |
| mutedForeground | `#64748b` | `#94a3b8` |
| accent | `#14b8a6` | `#2dd4bf` |
| accentForeground | `#ffffff` | `#0f172a` |
| destructive | `#ef4444` | `#f87171` |
| destructiveForeground | `#ffffff` | `#ffffff` |
| border / input | `#e2e8f0` | `#334155` |
| radius | `16px` | — |

Role accent colors (`ROLE_COLORS`, `src/types/roles.ts:40`): business `#7c3aed`,
customer `#2563eb`, digital `#0d9488`, local `#ea580c`, admin `#dc2626`.

---

## 3. Navigation → routing

Mobile: `AppNavigator.tsx` gates on `firebaseUser` → `role`, then mounts one of
five tab navigators plus 19 shared stack screens reachable from any role.

Web equivalent:

- `app/(auth)/` — `/login`, `/onboarding`. Splash has no route; it is the root
  loading state while `initializing || loadingProfile`.
- `app/(app)/` — authenticated shell. Sidebar nav, items filtered by role.
- `app/(admin)/` — admin-only segment, gated on `role === "admin"`.
- Role gating in a shared server-side layout check **plus** middleware. Never
  client-only — the mobile check was client-side because the API was the real
  gate; on web the Route Handlers are the real gate and must re-check.

### Per-role nav items (from the five tab navigators)

| Role | Tabs |
|---|---|
| business | Dashboard, PostRequirement, Search, Messages, Profile |
| customer | Home, Discover, Bookings, Notifications, Profile |
| digital | Dashboard, Earnings, Portfolio, Messages, Profile |
| local | Dashboard, Bookings, Messages, Notifications, Profile |
| admin | Dashboard, Users, Alerts, Profile |

---

## 4. Data entities

Firestore collections referenced by the existing backend, to be reproduced as
repository interfaces:

`users`, `requirements`, `quotes`, `bookings`, `messages`, `conversations`,
`reviews`, `notifications`, `disputes`, `portfolio`, `verification_requests`,
`subscriptions`, `audit_events`, `feature_flags`, `uploads`, `blocked_dates`,
`working_hours`, `referrals`, `profile_views`, `presence`, `reports`, `blocks`,
`rate_limits`, `email_queue`

~100 endpoints across 25 route modules define the operation surface. Repository
methods are modelled on these real operations, not generic CRUD. Full interface
listing lives in `DATABASE.md` once Phase 1 lands.

---

## 5. Platform-specific code — explicit decisions

Per brief §1.5, nothing here is silently dropped.

| Mobile | Location | Decision |
|---|---|---|
| `Platform.OS` keyboard avoidance | 6 screens | **Drop** — no web equivalent needed; keyboard avoidance is a mobile-only concern. |
| `KeyboardAwareScrollViewCompat` | `components/` | **Drop** — already no-ops on web (`Platform.OS === "web"` branch exists). |
| `@react-native-clipboard/clipboard` | ChatScreen, ReferralsScreen | **Port** → `navigator.clipboard.writeText` with a fallback. |
| `@react-native-community/datetimepicker` | AvailabilityScreen | **Port** → native `<input type="date">`. |
| `react-native-razorpay` | SubscriptionScreen | **Port** → Razorpay hosted Checkout.js. |
| `@react-native-firebase/messaging` (FCM) | AuthContext | **DEFERRED** — see below. |
| `@react-native-google-signin` | AuthContext, LoginScreen | **Port** → `signInWithPopup(GoogleAuthProvider)`. |
| Apple Sign-In (`/auth/apple` endpoint) | backend only | **Defer** — no web driver; endpoint exists but mobile-oriented. Re-evaluate if web users need it. |
| `AsyncStorage` session persistence | AuthContext | **Adapt** → Firebase Auth web persistence + httpOnly session cookie set via Route Handler. |
| Image picker | *none exists* | **N/A** — see §0.3. HTML file input. |
| `react-native-vector-icons` (Feather) | most screens | **Port** → `lucide-react` (Feather-derived, same icon names). |
| `react-native-linear-gradient` | ChatScreen, dashboards | **Port** → CSS `linear-gradient`. |

### Web push decision: **DEFERRED**

FCM web requires a registered `firebase-messaging-sw.js` service worker, a VAPID
key pair, and a browser permission prompt — none of which exist yet, and the
notification *data* path (`notifications` entity, `/notifications` endpoints,
NotificationsScreen) delivers full in-app parity without it. Mobile's own FCM
registration is already best-effort and non-blocking (`AuthContext.tsx:40-56`
swallows all errors), so deferring does not break a flow mobile depends on.

**What deferral means concretely:** the `fcmToken` field and
`PATCH /api/users/:id/fcm-token` operation are still modelled in the repository
layer, so enabling web push later is adding a service worker + permission prompt,
not a data-layer change. Phase 7 revisits this and either implements or re-confirms
the deferral.

---

## 6. Migration checklist

Risk categories: AUTH / PAYMENTS / PII / DATA_DELETION / INFRA / none.
Status: Not Started / In Progress / Ported / Reviewed / Done / Blocked.

### Phase 1 — Foundation

| Feature | Mobile source | Target web route | Data entities | Risk | Status | Notes |
|---|---|---|---|---|---|---|
| Next.js scaffold + Tailwind + tokens | `constants/colors.ts` | — | — | none | **Done** | Next 16.2.12, Tailwind 4, React 19. Tokens ported light+dark into `globals.css` |
| Repository interfaces | `artifacts/api-server/src/routes/*` | — | all | none | **Done** | 21 interfaces, ~130 methods, `src/lib/repositories/interfaces.ts` |
| Prisma schema + SQLite placeholder | — | — | all | INFRA | **Done** | 24 models, migration applied. Prisma pinned to 6 (see `DATABASE.md` §2) |
| Seed script | — | — | all | none | **Done** | 9 users / 5 roles, 4 requirements, 5 quotes, 5 bookings, 9 messages, disputes, KYC queue, flags |
| Firebase Auth wiring | `contexts/AuthContext.tsx` | — | users | AUTH | **Ported** | `lib/firebase/client.ts` + `admin.ts`. Needs UI (Phase 2) + review |
| Session cookie handler | `AsyncStorage` usage | `/api/auth/session` | users | AUTH | **Ported** | httpOnly, `verifyIdToken` before mint, revoke on sign-out. Needs review |
| Server-side role gating helpers | `AppNavigator.tsx:88-118` | — | users | AUTH | **Ported** | `requireUser` / `requireRole` / `requireAdmin` in `lib/auth/session.ts` |
| Rate limiting helper | `app.ts:107` | — | rate_limits | INFRA | **Ported** | 5 tiers in `lib/api/http.ts`; DB-backed (caveat in `DATABASE.md` §5) |
| Security headers | — | — | — | INFRA | **Ported** | `next.config.ts`. CSP deferred to Phase 8 with Razorpay |
| Health check | `routes/health.ts` | `/api/healthz` | — | INFRA | **Done** | Reports real DB reachability, 503 when down |
| `.env.example` | `src/config/env.ts` | — | — | INFRA | **Done** | Every var documented |

### Phase 2 — Shell

| Feature | Mobile source | Target web route | Data entities | Risk | Status | Notes |
|---|---|---|---|---|---|---|
| App shell + sidebar nav | 5 `*Navigator.tsx` | `(app)/layout.tsx` | users | none | **Ported** | Sidebar + mobile drawer, role-filtered per `lib/nav/config.ts` |
| Role gating | `AppNavigator.tsx:88-118` | `middleware.ts` + layouts | users | AUTH | **Ported** | Middleware is a redirect optimisation only (Edge can't verify); layouts + `requireRole` are the real gate |
| UI primitives | `components/ui.tsx` | — | — | none | **Ported** | Button/Card/Field/Badge/Avatar/EmptyState/Stat + INR + date formatting |
| Login | `auth/LoginScreen.tsx` | `/login` | users | AUTH | **Ported** | Google popup + email/password. Needs `security-reviewer` |
| Onboarding (role select) | `auth/OnboardingScreen.tsx` | `/onboarding` | users | AUTH | **Ported** | Server Action; admin deliberately not self-selectable; applies referral code |
| Splash / loading | `auth/SplashScreen.tsx` | — | — | none | **Done** | No web equivalent needed — server knows the session before first paint. Decision recorded |
| Role-branched dashboard | 4 `dashboards/*.tsx` | `/dashboard` | requirements, quotes, bookings, messages, analytics | none | **Ported** | Seeker vs provider variants on one route; admin redirects to `/admin` |

### Phase 3 — Customer & business flows

| Feature | Mobile source | Target web route | Data entities | Risk | Status | Notes |
|---|---|---|---|---|---|---|
| Customer dashboard | `dashboards/CustomerDashboard.tsx` | `/dashboard` | requirements, bookings | none | Not Started | |
| Business dashboard | `dashboards/BusinessDashboard.tsx` | `/dashboard` | requirements, quotes | none | Not Started | Same route, role-branched |
| Post requirement | `shared/PostRequirementScreen.tsx` | `/requirements/new` | requirements | none | Not Started | |
| Requirement detail | `shared/RequirementDetailScreen.tsx` | `/requirements/[id]` | requirements, quotes | none | Not Started | incl. shortlist |
| Search / discover | `shared/SearchScreen.tsx` | `/search` | users, requirements | none | Not Started | 3 search endpoints |
| Provider profile | `shared/ProviderProfileScreen.tsx` | `/providers/[id]` | users, reviews, portfolio, profile_views | PII | Not Started | |
| Bookings list | `customer/BookingsScreen.tsx` | `/bookings` | bookings | none | Not Started | |
| Booking detail | `shared/BookingDetailScreen.tsx` | `/bookings/[id]` | bookings | none | Not Started | |
| Quote detail | `shared/QuoteDetailScreen.tsx` | `/quotes/[id]` | quotes | none | Not Started | accept/reject/counter |
| Review | `shared/ReviewScreen.tsx` | `/bookings/[id]/review` | reviews | none | Not Started | |
| Dispute (raise) | `shared/DisputeScreen.tsx` | `/bookings/[id]/dispute` | disputes | PII | Not Started | evidence upload |
| Chat list | `shared/ChatListScreen.tsx` | `/messages` | conversations | PII | Not Started | |
| Chat thread | `shared/ChatScreen.tsx` | `/messages/[conversationId]` | messages, presence | PII | Not Started | REST polling per §0.1 |
| Notifications | `shared/NotificationsScreen.tsx` | `/notifications` | notifications | none | Not Started | |
| Profile | `shared/ProfileScreen.tsx` | `/profile` | users | PII | Not Started | |
| Settings | `shared/SettingsScreen.tsx` | `/settings` | users, notification prefs | PII | Not Started | |
| Phone verification | `shared/PhoneVerificationScreen.tsx` | `/settings/phone` | users | AUTH | Not Started | |

### Phase 4 — Provider flows

| Feature | Mobile source | Target web route | Data entities | Risk | Status | Notes |
|---|---|---|---|---|---|---|
| Digital dashboard | `dashboards/DigitalProviderDashboard.tsx` | `/dashboard` | quotes, bookings | none | Not Started | |
| Local dashboard | `dashboards/LocalProviderDashboard.tsx` | `/dashboard` | bookings, leads | none | Not Started | |
| Submit bid/quote | `shared/BidSubmitScreen.tsx` | `/requirements/[id]/bid` | quotes | none | Not Started | |
| Portfolio | `digital/PortfolioScreen.tsx` | `/portfolio` | portfolio, uploads | none | Not Started | file upload |
| Earnings | `digital/EarningsScreen.tsx` | `/earnings` | bookings, subscriptions | none | Not Started | |
| Availability | `shared/AvailabilityScreen.tsx` | `/availability` | working_hours, blocked_dates | none | Not Started | date input |
| Analytics | `shared/AnalyticsScreen.tsx` | `/analytics` | profile_views, bookings | none | Not Started | |
| Subscription + Razorpay | `shared/SubscriptionScreen.tsx` | `/subscription` | subscriptions | PAYMENTS | Not Started | Checkout.js + webhook |
| File storage abstraction | `lib/uploadService.ts` | `/api/uploads/*` | uploads | PII | Not Started | presign/PUT/confirm |

### Phase 5 — Admin panel

| Feature | Mobile source | Target web route | Data entities | Risk | Status | Notes |
|---|---|---|---|---|---|---|
| Admin dashboard | `dashboards/AdminDashboard.tsx` | `/admin` | users, requirements, quotes, bookings, disputes | none | Not Started | |
| Users management | `admin/UsersScreen.tsx` | `/admin/users` | users, audit_events | PII | Not Started | suspend/role/delete |
| Delete user | `routes/admin.ts:307` | `/admin/users` | users | DATA_DELETION | Not Started | |
| Disputes management | `admin/DisputesManagementScreen.tsx` | `/admin/disputes` | disputes | PII | Not Started | resolve |
| Verification queue | `admin/VerificationQueueScreen.tsx` | `/admin/verification` | verification_requests | PII | Not Started | KYC approve/reject |
| Feature flags | `routes/admin.ts:466` | `/admin/flags` | feature_flags | INFRA | Not Started | no mobile screen — backend-only today |
| Fraud views | `routes/admin.ts:510,564` | `/admin/fraud` | users, reviews | PII | Not Started | no mobile screen |
| Revenue / growth stats | `routes/admin.ts:598,627` | `/admin/revenue` | subscriptions, users | none | Not Started | no mobile screen |
| Audit log viewer | `routes/admin.ts:121` | `/admin/audit` | audit_events | PII | Not Started | no mobile screen |
| Flagged messages | `routes/admin.ts:414` | `/admin/moderation` | messages, reports | PII | Not Started | no mobile screen |

> Admin rows marked "no mobile screen" have backend endpoints but no mobile UI.
> Building them is **in scope** — the brief explicitly says the admin panel exists
> only embedded in mobile today and web is where it becomes real. These are ports
> of existing *capabilities*, not invented features.

### Phase 6 — Cross-cutting

| Feature | Mobile source | Target web route | Data entities | Risk | Status | Notes |
|---|---|---|---|---|---|---|
| Referrals | `shared/ReferralsScreen.tsx` | `/referrals` | referrals | none | Not Started | clipboard |
| Presence heartbeat | `routes/presence.ts` | `/api/presence/*` | presence | none | Not Started | |
| Block / report user | `routes/blocking.ts` | in-context actions | blocks, reports | PII | Not Started | |
| GDPR export | `routes/gdpr.ts:131` | `/settings/data` | all | PII | Not Started | |
| GDPR account deletion | `routes/gdpr.ts:40,88` | `/settings/data` | all | DATA_DELETION | Not Started | + cancel-deletion |
| Rate limiting | `app.ts:107` | Route Handler middleware | rate_limits | INFRA | Not Started | Brief §7.5 |

### Phase 7 — Web push

| Feature | Mobile source | Target web route | Data entities | Risk | Status | Notes |
|---|---|---|---|---|---|---|
| Web push decision | `AuthContext.tsx:40-56` | — | users.fcmToken | INFRA | **Decided: DEFERRED** | §5. Data path modelled; revisit in Phase 7 |

### Phase 8 — Deployment readiness

| Item | Status | Notes |
|---|---|---|
| `next build` clean | Not Started | |
| `.env.example` complete | Not Started | |
| Secrets gitignored | Not Started | |
| Health endpoint | Not Started | Phase 1 |
| Security headers + rate limiting | Not Started | |
| Hosting target decision | Not Started | Vercel default; SQLite-on-serverless caveat — see `DATABASE.md` |
| CI production build check | Not Started | |
| README deploy instructions | Not Started | |

---

## 7. Known environment gaps

Recorded so they are not mistaken for oversights.

**Review agents referenced by the brief that do not exist in this environment:**
`database-reviewer`, `test-executor`, `ux-reviewer`, `accessibility-reviewer`,
`release-auditor`, and the `/full-review-pipeline` command.

Available and in use: `code-reviewer`, `code-simplifier`, `security-reviewer`,
`architecture-reviewer`, `risk-classifier`, `performance-reviewer`,
`test-generater`.

Per the user's decision on 2026-08-01: use what exists, perform the missing
reviews inline and label them as inline, and replace the `/full-review-pipeline`
exit gate with a documented final sweep of the available agents. **The brief's
stated exit condition (`/full-review-pipeline` returning `APPROVED`) cannot be
met in this environment and must not be reported as met.**

**Repo:** `https://github.com/TusharChauhan04/SRN-web-app.git` (was empty at clone
time). The mobile repo is read-only reference and is not modified.
---

## 8. Open blockers for a human

### 8.1 Push access denied

`git push` to `https://github.com/TusharChauhan04/SRN-web-app.git` fails:

```
remote: Permission to TusharChauhan04/SRN-web-app.git denied to Info-DNT.
fatal: ... error: 403
```

The machine's cached GitHub credential is the account `Info-DNT`, which does not
have write access to a repo owned by `TusharChauhan04`. Work is committed
locally and safe; nothing is lost.

Any one of these unblocks it:
- add `Info-DNT` as a collaborator on the repo, or
- switch the machine's git credential to the `TusharChauhan04` account
  (Windows Credential Manager → `git:https://github.com`), or
- point `origin` at a repo the current account can write to.

Then: `git push -u origin main`.

### 8.2 Firebase credentials not set

`/api/healthz` currently reports `"firebaseAdmin": "missing"`. Sign-in cannot
work until both halves are configured in `.env.local`:

- `NEXT_PUBLIC_FIREBASE_*` — Firebase Console → Project settings → Web app
- `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` —
  Project settings → Service accounts → Generate new private key

The mobile app uses Firebase project `skill-requirement-network`. Reusing it
keeps one identity across mobile and web (the recorded decision in §1) — that
requires registering a **Web app** in that existing project, which is additive
and does not modify the mobile app.

Also add `localhost` to Firebase Auth → Settings → Authorized domains, or the
Google popup will be rejected.

### 8.3 Review status — partial

Two separate gaps, do not conflate them.

**Agents that do not exist in this environment** (per §7):
`database-reviewer`, `test-executor`, `ux-reviewer`, `accessibility-reviewer`,
`release-auditor`, `/full-review-pipeline`.

**Agents that exist but failed to complete** — hit an API session limit
mid-run on 2026-08-01: `security-reviewer`, `code-reviewer`,
`risk-classifier`. These need re-running.

**Completed:** `architecture-reviewer` only. Its findings were applied — see
the commit "Apply architecture review findings".

> **Nothing in this repo has been security-reviewed.** The auth flow, session
> cookie handling, role gating, and the GDPR/KYC paths in the repository layer
> are all unreviewed `AUTH`/`PII` surface. Re-run `security-reviewer`,
> `code-reviewer`, and `risk-classifier` before this is treated as
> production-ready or before Phase 4 adds payments.

**Known-unfixed findings from the architecture review** (deliberately deferred,
not forgotten):

| Finding | Why deferred |
|---|---|
| `mappers.ts` types its input as `Record<string, unknown>` and casts every field, so a renamed column typechecks clean | Real gap. `DATABASE.md` §4 was corrected to stop claiming typecheck catches this, and the seed does catch it. Tightening to `Prisma.*GetPayload<...>` is the proper fix |
| Optional joined fields (`Requirement.quoteCount`, `Conversation.counterpart`/`unreadCount`) are populated by some repository methods and not others, with no type-level signal | Should be split into `Requirement` vs `RequirementListItem` etc. **Do this before Phase 3 grows more call sites** |
| No `services/` layer; policy logic (dispute→booking transitions, verification→isVerified) lives inside repositories | Recommended: add `services/` plus a `transaction()` method on the registry, move *policy* out but keep *invariants* in |
| `RateLimitRepository` is not really a repository, and its `hit()` is check-then-act (TOCTOU) on the auth path | Should move to `src/lib/ratelimit/` with its own provider interface |
| No tests, no test runner | Blocks `test-generater` / `test-executor` from being useful |
| `components/ui.tsx` is one file exporting ~12 components | Split to `components/ui/` before Phase 3 |
