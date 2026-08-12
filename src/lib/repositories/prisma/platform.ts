import { prisma } from "@/lib/db/client";
import {
  RepositoryConflictError,
  assertAdmin,
  type Actor,
} from "../authorize";
import type {
  AuditRepository,
  PhoneChallenge,
  PhoneVerificationRepository,
  CreateNotificationInput,
  CreateUploadInput,
  FeatureFlagRepository,
  HealthRepository,
  NotificationRepository,
  PresenceRepository,
  RateLimitRepository,
  ReferralRepository,
  UploadRepository,
} from "../interfaces";
import {
  normalizePageParams,
  type AuditEvent,
  type FeatureFlag,
  type Notification,
  type NotificationPrefs,
  type Page,
  type PageParams,
  type Presence,
  type Referral,
  type Upload,
  type UploadContext,
} from "../types";
import {
  stringifyJson,
  toAuditEvent,
  toFeatureFlag,
  toNotification,
  toNotificationPrefs,
  toPhoneChallenge,
  toPresence,
  toReferral,
  toUpload,
} from "./mappers";

/** How long since the last heartbeat a user still counts as online. */
export const PRESENCE_TTL_MS = 90_000;

// ─────────────────────────── Notifications ───────────────────────────

export class PrismaNotificationRepository implements NotificationRepository {
  async create(input: CreateNotificationInput): Promise<Notification> {
    const row = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: stringifyJson(input.data),
      },
    });
    return toNotification(row);
  }

  async list(
    userId: string,
    filter: PageParams & { unreadOnly?: boolean } = {},
  ): Promise<Page<Notification>> {
    const { limit, offset } = normalizePageParams(filter);
    const where = { userId, ...(filter.unreadOnly && { read: false }) };

    const [items, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.notification.count({ where }),
    ]);

    return { items: items.map(toNotification), total, limit, offset };
  }

  async markRead(id: string, userId: string): Promise<Notification> {
    // Scoped by userId so one user cannot mark another's notification read.
    const result = await prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
    if (result.count === 0) throw new Error("Notification not found");

    const row = await prisma.notification.findUniqueOrThrow({ where: { id } });
    return toNotification(row);
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return result.count;
  }

  countUnread(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, read: false } });
  }

  async getPrefs(userId: string): Promise<NotificationPrefs> {
    /*
     * A READ. It used to be an upsert, which wrote a row on every call — and
     * `notify()` calls this for every notification, so a read path was issuing
     * a write transaction per delivered message. On SQLite, where there is one
     * writer at a time, that put chat traffic behind the write lock.
     *
     * Falling back to the defaults in code means no row has to exist. `setPrefs`
     * still upserts, so the row is created the first time someone changes
     * anything — which is the only time it carries information.
     */
    const row = await prisma.notificationPref.findUnique({ where: { userId } });
    if (row) return toNotificationPrefs(row);

    // Must match the @default values in schema.prisma.
    return {
      userId,
      push: true,
      email: true,
      quotes: true,
      bookings: true,
      messages: true,
      marketing: false,
    };
  }

  async setPrefs(
    userId: string,
    prefs: Partial<Omit<NotificationPrefs, "userId">>,
  ): Promise<NotificationPrefs> {
    const row = await prisma.notificationPref.upsert({
      where: { userId },
      create: { userId, ...prefs },
      update: prefs,
    });
    return toNotificationPrefs(row);
  }
}

// ─────────────────────────── Referrals ───────────────────────────

/** Ambiguous glyphs (0/O, 1/I) are excluded — these codes get read aloud. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export class PrismaReferralRepository implements ReferralRepository {
  /**
   * Idempotent and safe to call concurrently.
   *
   * The read-then-create version raced with itself: two parallel calls for a
   * user with no row both saw none and both inserted, and the second violated
   * the primary key. That surfaced as a 500 on the FIRST load of /referrals for
   * every new user, then worked on reload — which is exactly the shape of bug
   * that survives manual testing.
   */
  async getOrCreateCode(userId: string): Promise<Referral> {
    const existing = await prisma.referral.findUnique({ where: { userId } });
    if (existing) return toReferral(existing);

    // Retry covers two distinct collisions: a duplicate code, and a concurrent
    // insert of this same userId.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      try {
        const row = await prisma.referral.create({ data: { userId, code } });
        return toReferral(row);
      } catch {
        // Lost the race on userId — the other call already created the row.
        const now = await prisma.referral.findUnique({ where: { userId } });
        if (now) return toReferral(now);
        // Otherwise the code collided; loop and pick another.
      }
    }
    throw new Error("Could not generate a unique referral code");
  }

  async findByCode(code: string): Promise<Referral | null> {
    const row = await prisma.referral.findUnique({
      where: { code: code.toUpperCase() },
    });
    return row ? toReferral(row) : null;
  }

  /**
   * The atomic half of applying a referral. The RULES are in
   * referrals.service.ts — see the interface docstring for why.
   */
  async claimReferral(input: {
    newUserId: string;
    ownerUserId: string;
    rewardPoints: number;
  }): Promise<Referral> {
    // Ensure the new user has a referral row before the transaction claims it.
    await this.getOrCreateCode(input.newUserId);

    // Interactive transaction: the read of `referredById` and the write that
    // sets it must not be separated, or two concurrent submissions both see
    // null and the owner is credited twice for one referred user.
    return prisma.$transaction(async (tx) => {
      const claim = await tx.referral.updateMany({
        // Conditional update IS the check — only succeeds while still unset.
        where: { userId: input.newUserId, referredById: null },
        data: { referredById: input.ownerUserId },
      });
      if (claim.count === 0) {
        throw new RepositoryConflictError(
          "A referral code has already been applied",
        );
      }

      const updatedOwner = await tx.referral.update({
        where: { userId: input.ownerUserId },
        data: {
          signupCount: { increment: 1 },
          rewardPoints: { increment: input.rewardPoints },
        },
      });

      return toReferral(updatedOwner);
    });
  }

  async stats(
    userId: string,
  ): Promise<{ signupCount: number; rewardPoints: number }> {
    const row = await this.getOrCreateCode(userId);
    return { signupCount: row.signupCount, rewardPoints: row.rewardPoints };
  }

  async leaderboard(
    limit = 10,
  ): Promise<(Referral & { name: string; avatarUrl?: string | null })[]> {
    const rows = await prisma.referral.findMany({
      where: { signupCount: { gt: 0 } },
      orderBy: { signupCount: "desc" },
      take: limit,
      include: { user: { select: { name: true, avatarUrl: true } } },
    });

    return rows.map((r) => ({
      ...toReferral(r),
      name: r.user.name,
      avatarUrl: r.user.avatarUrl,
    }));
  }
}

// ─────────────────────────── Presence ───────────────────────────

export class PrismaPresenceRepository implements PresenceRepository {
  async heartbeat(userId: string): Promise<Presence> {
    const row = await prisma.presence.upsert({
      where: { userId },
      create: { userId, isOnline: true },
      update: { isOnline: true, lastHeartbeat: new Date() },
    });
    return toPresence(row);
  }

  async setOffline(userId: string): Promise<void> {
    await prisma.presence.upsert({
      where: { userId },
      create: { userId, isOnline: false },
      update: { isOnline: false },
    });
  }

  async get(userId: string): Promise<Presence | null> {
    const row = await prisma.presence.findUnique({ where: { userId } });
    if (!row) return null;
    return this.withStaleness(toPresence(row));
  }

  async getMany(userIds: string[]): Promise<Presence[]> {
    const rows = await prisma.presence.findMany({
      where: { userId: { in: userIds } },
    });
    return rows.map((r) => this.withStaleness(toPresence(r)));
  }

  /**
   * A stale heartbeat means offline regardless of the stored flag — a client
   * that crashed never got to call setOffline. Mirrors the mobile client's own
   * `Date.now() - lastHeartbeat < 90_000` check in ChatScreen.
   */
  private withStaleness(p: Presence): Presence {
    const fresh = Date.now() - p.lastHeartbeat.getTime() < PRESENCE_TTL_MS;
    return { ...p, isOnline: p.isOnline && fresh };
  }
}

// ─────────────────────────── Uploads ───────────────────────────

export class PrismaUploadRepository implements UploadRepository {
  async create(input: CreateUploadInput): Promise<Upload> {
    const row = await prisma.upload.create({
      data: {
        userId: input.userId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        context: input.context,
        entityId: input.entityId ?? null,
        storageKey: input.storageKey,
      },
    });
    return toUpload(row);
  }

  async findById(id: string): Promise<Upload | null> {
    const row = await prisma.upload.findUnique({ where: { id } });
    return row ? toUpload(row) : null;
  }

  async confirm(id: string, publicUrl: string): Promise<Upload> {
    const row = await prisma.upload.update({
      where: { id },
      data: { confirmed: true, publicUrl },
    });
    return toUpload(row);
  }

  async delete(id: string): Promise<void> {
    await prisma.upload.delete({ where: { id } });
  }

  async listByUser(
    userId: string,
    context?: UploadContext,
  ): Promise<Upload[]> {
    const rows = await prisma.upload.findMany({
      where: { userId, ...(context && { context }) },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toUpload);
  }
}

// ─────────────────────────── Audit ───────────────────────────

export class PrismaAuditRepository implements AuditRepository {
  async record(input: {
    actorId?: string;
    action: string;
    target?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
  }): Promise<AuditEvent> {
    const row = await prisma.auditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        target: input.target ?? null,
        metadata: stringifyJson(input.metadata),
        ip: input.ip ?? null,
      },
    });
    return toAuditEvent(row);
  }

  async list(
    filter: PageParams & { actorId?: string; action?: string } = {},
  ): Promise<Page<AuditEvent>> {
    const { limit, offset } = normalizePageParams(filter);
    const where = {
      ...(filter.actorId && { actorId: filter.actorId }),
      ...(filter.action && { action: filter.action }),
    };

    const [items, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    return { items: items.map(toAuditEvent), total, limit, offset };
  }
}

// ─────────────────────────── Feature flags ───────────────────────────

export class PrismaFeatureFlagRepository implements FeatureFlagRepository {
  async list(): Promise<FeatureFlag[]> {
    const rows = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
    return rows.map(toFeatureFlag);
  }

  async get(key: string): Promise<FeatureFlag | null> {
    const row = await prisma.featureFlag.findUnique({ where: { key } });
    return row ? toFeatureFlag(row) : null;
  }

  async set(
    key: string,
    enabled: boolean,
    actor: Actor,
    description?: string,
  ): Promise<FeatureFlag> {
    // Flags change platform behaviour for everyone — admin only.
    assertAdmin(actor, "featureFlags.set");
    const row = await prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, description: description ?? null },
      update: { enabled, ...(description !== undefined && { description }) },
    });
    return toFeatureFlag(row);
  }
}

// ─────────────────────────── Rate limiting ───────────────────────────

export class PrismaRateLimitRepository implements RateLimitRepository {
  /**
   * Single atomic upsert. `allowed` is derived from the count the database
   * actually wrote, on BOTH the rollover and increment paths.
   *
   * The previous read-then-branch version returned a hardcoded
   * `allowed: true` whenever the window had expired, so N concurrent requests
   * at window rollover all passed — an attacker could burst, wait one window,
   * and burst again without limit.
   *
   * This is deliberately raw, dialect-specific SQL. It lives in the Prisma
   * implementation directory where that is allowed, but it IS one of the few
   * places a database swap has to rewrite rather than re-point. Noted in
   * DATABASE.md.
   */
  async hit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    /*
     * Fail LOUD on a nonsensical window rather than open.
     *
     * windowMs <= 0 writes an expiry that is already past, so every subsequent
     * request takes the reset branch and the limiter is silently off. Negative
     * is worse: concurrent hits sharing one expired window all reset together,
     * which is the exact burst hole this design was written to close. A window
     * beyond ~8.64e15 makes the timestamp invalid and throws from inside the
     * driver, at a call site that sits before the gateway's try/catch.
     *
     * No caller passes these today (see rate limits in gateway/core.ts); this
     * is here so a future misconfiguration cannot disable throttling quietly.
     */
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error(
        `Rate limit windowMs must be a positive finite number, got ${windowMs}`,
      );
    }

    const windowSeconds = windowMs / 1000;

    /*
     * TIME COMES FROM THE DATABASE, not from this process.
     *
     * `now()` is the transaction timestamp — stable across the whole statement,
     * so both CASE arms and the INSERT agree by construction.
     *
     * It used to be `new Date()` bound from Node, which put every instance's
     * clock inside the trust boundary. The skew is asymmetric and the dangerous
     * direction is silent: a clock running FAST over-limits and fails closed,
     * but a clock running SLOW by more than one window writes an expiry that is
     * already in the past, so the next request from any instance sees an
     * expired window and resets the count. Every request resets. Rate limiting
     * is off for every key that instance touches, with no error anywhere.
     * Same failure class as the bug this method's docstring records, reached
     * from a different direction.
     *
     * (Bound datetimes were also what broke on the SQLite→Postgres move: the
     * old query passed unix-ms integers into a timestamp(3) column, which
     * Postgres rejects with 42804. Using now() removes the binding entirely.)
     *
     * `AT TIME ZONE 'UTC'` is NOT decoration. `now()` is timestamptz; the column
     * is timestamp(3) WITHOUT time zone, so a bare now() is implicitly cast
     * using the session TimeZone. Throttling still works — both sides of the
     * comparison take the same cast — but the expiry handed back to the caller
     * is skewed by the server's UTC offset, and gateway/core.ts turns it into a
     * Retry-After header. On a server set to Asia/Kolkata a 60-second window
     * returns `Retry-After: 19800`: a five-and-a-half-hour lockout that a
     * well-behaved client obeys. Supabase and the CI container both default to
     * UTC, so nothing here would ever have caught it; Azure exposes `timezone`
     * as a settable server parameter, which is where it would have appeared.
     */
    const rows = await prisma.$queryRaw<{ count: number; expiresAt: Date }[]>`
      INSERT INTO "RateLimit" ("key", "count", "expiresAt")
      VALUES (${key}, 1, (now() AT TIME ZONE 'UTC') + make_interval(secs => ${windowSeconds}::float8))
      ON CONFLICT("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimit"."expiresAt" <= (now() AT TIME ZONE 'UTC') THEN 1
          ELSE "RateLimit"."count" + 1
        END,
        "expiresAt" = CASE
          WHEN "RateLimit"."expiresAt" <= (now() AT TIME ZONE 'UTC')
            THEN (now() AT TIME ZONE 'UTC') + make_interval(secs => ${windowSeconds}::float8)
          -- PRESERVED, not extended. A sliding window here would let a client
          -- that retries on 429 push its own unlock further away with every
          -- attempt — which is exactly what Retry-After encourages it to do —
          -- and lock itself out permanently.
          ELSE "RateLimit"."expiresAt"
        END
      RETURNING "count", "expiresAt"
    `;

    const row = rows[0];
    if (!row) {
      // Should be unreachable — RETURNING always yields a row here. Fail
      // closed rather than silently granting unlimited access.
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(Date.now() + windowMs),
      };
    }

    const count = Number(row.count);
    // RETURNING hands back a Date on Postgres. The old code wrapped this in
    // Number(), which on a Date yields NaN and an Invalid Date reset time.
    const windowResetAt = new Date(row.expiresAt);

    /*
     * Awaited and bounded, where it used to be floating and unbounded.
     *
     * `void`-ing it looked free and was not. With connection_limit=1 — which
     * this deployment mandates for Vercel — the detached DELETE seizes the
     * invocation's only connection the moment hit() releases it, and everything
     * downstream queues behind it; past the 10s pool timeout that surfaces as a
     * random 500 on 1% of requests. And on serverless it likely never finished
     * anyway: nothing awaited it, so the invocation froze the moment the
     * response was written and the DELETE rolled back. A sweep that cannot
     * complete does not bound the table it exists to bound, and the .catch()
     * ensured nobody found out.
     *
     * LIMIT caps the work so the 1% of requests that pay for it pay a
     * predictable amount. This still belongs on a scheduler; the comment that
     * traded a scheduler for probability was assuming a sweep that runs.
     */
    if (Math.random() < 0.01) {
      try {
        await prisma.$executeRaw`
          DELETE FROM "RateLimit"
          WHERE "key" IN (
            SELECT "key" FROM "RateLimit" WHERE "expiresAt" < now() LIMIT 1000
          )
        `;
      } catch {
        // Housekeeping only — never fail the request it piggybacks on.
      }
    }

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: windowResetAt,
    };
  }
}

// ─────────────────────────── Phone verification ───────────────────────────

export class PrismaPhoneVerificationRepository
  implements PhoneVerificationRepository
{
  async start(input: {
    userId: string;
    phone: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<PhoneChallenge> {
    // Upsert, not insert: requesting a new code must invalidate the previous
    // one, or an old code stays usable for its full lifetime after a resend.
    const row = await prisma.phoneVerification.upsert({
      where: { userId: input.userId },
      create: { ...input, attempts: 0 },
      update: { ...input, attempts: 0 },
    });
    return toPhoneChallenge(row);
  }

  async find(userId: string): Promise<PhoneChallenge | null> {
    const row = await prisma.phoneVerification.findUnique({ where: { userId } });
    return row ? toPhoneChallenge(row) : null;
  }

  async recordAttempt(userId: string): Promise<number> {
    const row = await prisma.phoneVerification.update({
      where: { userId },
      data: { attempts: { increment: 1 } },
    });
    return row.attempts;
  }

  async clear(userId: string): Promise<void> {
    await prisma.phoneVerification
      .delete({ where: { userId } })
      .catch(() => {
        // Already gone is the desired end state.
      });
  }
}

// ─────────────────────────── Health ───────────────────────────

export class PrismaHealthRepository implements HealthRepository {
  async ping(): Promise<boolean> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
