import { prisma } from "@/lib/db/client";
import type {
  AuditRepository,
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
  async getOrCreateCode(userId: string): Promise<Referral> {
    const existing = await prisma.referral.findUnique({ where: { userId } });
    if (existing) return toReferral(existing);

    // Retry on the (unlikely) collision rather than failing the request.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const taken = await prisma.referral.findUnique({ where: { code } });
      if (taken) continue;
      const row = await prisma.referral.create({ data: { userId, code } });
      return toReferral(row);
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

    // Ensure the new user has a referral row, and record who referred them.
    await this.getOrCreateCode(newUserId);
    const alreadyReferred = await prisma.referral.findUnique({
      where: { userId: newUserId },
      select: { referredById: true },
    });
    if (alreadyReferred?.referredById) {
      throw new Error("A referral code has already been applied");
    }

    const [, updatedOwner] = await prisma.$transaction([
      prisma.referral.update({
        where: { userId: newUserId },
        data: { referredById: owner.userId },
      }),
      prisma.referral.update({
        where: { userId: owner.userId },
        data: {
          signupCount: { increment: 1 },
          rewardPoints: { increment: 100 },
        },
      }),
    ]);

    return toReferral(updatedOwner);
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
    description?: string,
  ): Promise<FeatureFlag> {
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
  async hit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
    const now = new Date();
    const existing = await prisma.rateLimit.findUnique({ where: { key } });

    // Expired or absent window → start a fresh one.
    if (!existing || existing.expiresAt <= now) {
      const resetAt = new Date(now.getTime() + windowMs);
      await prisma.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, expiresAt: resetAt },
        update: { count: 1, expiresAt: resetAt },
      });
      return { allowed: true, remaining: limit - 1, resetAt };
    }

    const updated = await prisma.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 } },
    });

    return {
      allowed: updated.count <= limit,
      remaining: Math.max(0, limit - updated.count),
      resetAt: updated.expiresAt,
    };
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
