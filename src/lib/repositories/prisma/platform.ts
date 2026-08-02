import { prisma } from "@/lib/db/client";
import { assertAdmin, type Actor } from "../authorize";
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
    const row = await prisma.notificationPref.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return toNotificationPrefs(row);
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

  async applyCode(code: string, newUserId: string): Promise<Referral> {
    const owner = await prisma.referral.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!owner) throw new Error("Invalid referral code");
    if (owner.userId === newUserId) {
      throw new Error("Cannot apply your own referral code");
    }

    // Reciprocal farming guard: two throwaway accounts applying each other's
    // codes used to mint points with no third party involved.
    if (owner.referredById === newUserId) {
      throw new Error("Reciprocal referrals are not allowed");
    }

    // Ensure the new user has a referral row before the transaction claims it.
    await this.getOrCreateCode(newUserId);

    // Interactive transaction: the read of `referredById` and the write that
    // sets it must not be separated, or two concurrent submissions both see
    // null and the owner is credited twice for one referred user.
    return prisma.$transaction(async (tx) => {
      const claim = await tx.referral.updateMany({
        // Conditional update IS the check — only succeeds while still unset.
        where: { userId: newUserId, referredById: null },
        data: { referredById: owner.userId },
      });
      if (claim.count === 0) {
        throw new Error("A referral code has already been applied");
      }

      const updatedOwner = await tx.referral.update({
        where: { userId: owner.userId },
        data: {
          signupCount: { increment: 1 },
          rewardPoints: { increment: 100 },
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
    const nowMs = Date.now();
    const resetMs = nowMs + windowMs;

    // Prisma stores SQLite DateTime as INTEGER unix-ms, so bind numbers.
    const rows = await prisma.$queryRaw<
      { count: number; expiresAt: number }[]
    >`
      INSERT INTO "RateLimit" ("key", "count", "expiresAt")
      VALUES (${key}, 1, ${resetMs})
      ON CONFLICT("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimit"."expiresAt" <= ${nowMs} THEN 1
          ELSE "RateLimit"."count" + 1
        END,
        "expiresAt" = CASE
          WHEN "RateLimit"."expiresAt" <= ${nowMs} THEN ${resetMs}
          ELSE "RateLimit"."expiresAt"
        END
      RETURNING "count", "expiresAt"
    `;

    const row = rows[0];
    if (!row) {
      // Should be unreachable — RETURNING always yields a row here. Fail
      // closed rather than silently granting unlimited access.
      return { allowed: false, remaining: 0, resetAt: new Date(resetMs) };
    }

    const count = Number(row.count);
    const resetAt = new Date(Number(row.expiresAt));

    // Opportunistic sweep of expired rows. The key is caller-derived and
    // partly client-influenced, so without this the table grows unbounded.
    // Probabilistic to avoid needing a scheduler.
    if (Math.random() < 0.01) {
      void prisma.rateLimit
        .deleteMany({ where: { expiresAt: { lt: new Date(nowMs) } } })
        .catch(() => {
          // Housekeeping only — never fail the request it piggybacks on.
        });
    }

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt,
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
