import { prisma } from "@/lib/db/client";
import type {
  AnalyticsRepository,
  AvailabilityRepository,
  CreatePortfolioInput,
  PortfolioRepository,
  ProviderAnalytics,
  SubscriptionRepository,
} from "../interfaces";
import {
  normalizePageParams,
  type BlockedDate,
  type Page,
  type PageParams,
  type PortfolioItem,
  type Subscription,
  type SubscriptionTier,
  type WorkingHours,
} from "../types";
import {
  toBlockedDate,
  toPortfolioItem,
  toSubscription,
  toWorkingHours,
} from "./mappers";

/** Monthly price in paise (Razorpay's smallest unit), mirroring mobile's plans. */
export const SUBSCRIPTION_PRICES: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 49900, // ₹499
  elite: 149900, // ₹1499
};

/**
 * Normalises a date to UTC midnight so blocked-date lookups are exact.
 *
 * IMPORTANT CONTRACT: every date the availability code touches is interpreted
 * in UTC, and `WorkingHours.startTime`/`endTime` are wall-clock times in the
 * SAME frame. Mixing the two frames is what previously caused availability to
 * be computed for the wrong weekday and to never detect an already-booked
 * hour, so callers must not pass a local-midnight Date.
 *
 * KNOWN LIMITATION: there is no per-provider timezone column, so "wall clock"
 * is effectively UTC for everyone. A provider in IST setting 09:00-18:00 is
 * really offering 14:30-23:30 local. Fixing this properly needs a `timezone`
 * field on User and conversion at the boundary — tracked in
 * WEB_MIGRATION_PLAN.md, not silently ignored.
 */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** "09:30" → 570. Returns null for malformed input rather than NaN. */
function parseClockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatClock(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const SLOT_MINUTES = 60;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─────────────────────────── Portfolio ───────────────────────────

export class PrismaPortfolioRepository implements PortfolioRepository {
  async create(input: CreatePortfolioInput): Promise<PortfolioItem> {
    const row = await prisma.portfolioItem.create({
      data: {
        userId: input.userId,
        title: input.title,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        projectUrl: input.projectUrl ?? null,
      },
    });
    return toPortfolioItem(row);
  }

  async findById(id: string): Promise<PortfolioItem | null> {
    const row = await prisma.portfolioItem.findUnique({ where: { id } });
    return row ? toPortfolioItem(row) : null;
  }

  async listByUser(
    userId: string,
    params: PageParams = {},
  ): Promise<Page<PortfolioItem>> {
    const { limit, offset } = normalizePageParams(params);
    const where = { userId };

    const [items, total] = await Promise.all([
      prisma.portfolioItem.findMany({
        where,
        orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
        take: limit,
        skip: offset,
      }),
      prisma.portfolioItem.count({ where }),
    ]);

    return { items: items.map(toPortfolioItem), total, limit, offset };
  }

  async update(
    id: string,
    input: Partial<Omit<CreatePortfolioInput, "userId">>,
  ): Promise<PortfolioItem> {
    const row = await prisma.portfolioItem.update({
      where: { id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && {
          description: input.description,
        }),
        ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
        ...(input.projectUrl !== undefined && { projectUrl: input.projectUrl }),
      },
    });
    return toPortfolioItem(row);
  }

  async setFeatured(id: string, featured: boolean): Promise<PortfolioItem> {
    const row = await prisma.portfolioItem.update({
      where: { id },
      data: { isFeatured: featured },
    });
    return toPortfolioItem(row);
  }

  async incrementLikes(id: string): Promise<PortfolioItem> {
    const row = await prisma.portfolioItem.update({
      where: { id },
      data: { likeCount: { increment: 1 } },
    });
    return toPortfolioItem(row);
  }

  async delete(id: string): Promise<void> {
    await prisma.portfolioItem.delete({ where: { id } });
  }
}

// ─────────────────────────── Availability ───────────────────────────

export class PrismaAvailabilityRepository implements AvailabilityRepository {
  async getWorkingHours(userId: string): Promise<WorkingHours[]> {
    const rows = await prisma.workingHours.findMany({
      where: { userId },
      orderBy: { dayOfWeek: "asc" },
    });
    return rows.map(toWorkingHours);
  }

  async setWorkingHours(
    userId: string,
    hours: Omit<WorkingHours, "id" | "userId">[],
  ): Promise<WorkingHours[]> {
    // Replace wholesale — the editor submits the full week, so a diff would
    // leave orphaned days behind.
    await prisma.$transaction([
      prisma.workingHours.deleteMany({ where: { userId } }),
      prisma.workingHours.createMany({
        data: hours.map((h) => ({
          userId,
          dayOfWeek: h.dayOfWeek,
          startTime: h.startTime,
          endTime: h.endTime,
          isEnabled: h.isEnabled,
        })),
      }),
    ]);
    return this.getWorkingHours(userId);
  }

  async listBlockedDates(userId: string): Promise<BlockedDate[]> {
    const rows = await prisma.blockedDate.findMany({
      where: { userId },
      orderBy: { date: "asc" },
    });
    return rows.map(toBlockedDate);
  }

  async blockDate(
    userId: string,
    date: Date,
    reason?: string,
  ): Promise<BlockedDate> {
    const day = startOfDay(date);
    const row = await prisma.blockedDate.upsert({
      where: { userId_date: { userId, date: day } },
      create: { userId, date: day, reason: reason ?? null },
      update: { reason: reason ?? null },
    });
    return toBlockedDate(row);
  }

  async unblockDate(userId: string, date: Date): Promise<void> {
    await prisma.blockedDate.deleteMany({
      where: { userId, date: startOfDay(date) },
    });
  }

  async getAvailableSlots(
    providerId: string,
    date: Date,
  ): Promise<{ start: string; end: string }[]> {
    const day = startOfDay(date);

    const [blocked, hours, bookings] = await Promise.all([
      prisma.blockedDate.findFirst({ where: { userId: providerId, date: day } }),
      prisma.workingHours.findFirst({
        where: {
          userId: providerId,
          dayOfWeek: day.getUTCDay(),
          isEnabled: true,
        },
      }),
      prisma.booking.findMany({
        where: {
          providerId,
          scheduledFor: {
            gte: day,
            lt: new Date(day.getTime() + 24 * 60 * 60 * 1000),
          },
          status: { notIn: ["cancelled"] },
        },
        select: { scheduledFor: true },
      }),
    ]);

    if (blocked || !hours) return [];

    const startMinutes = parseClockMinutes(hours.startTime);
    const endMinutes = parseClockMinutes(hours.endTime);
    // Malformed hours are a data problem, not "fully booked" — surface it
    // rather than silently reporting no availability.
    if (startMinutes === null || endMinutes === null) {
      throw new Error(
        `Invalid working hours for provider ${providerId}: ${hours.startTime}-${hours.endTime}`,
      );
    }
    if (endMinutes <= startMinutes) return [];

    // Booked minutes-from-midnight in the SAME UTC frame as the working hours,
    // so a booking actually collides with the slot it occupies. Comparing
    // getUTCHours() against locally-written "09:00" strings meant nothing ever
    // matched and every booked slot was offered again.
    const bookedMinutes = new Set(
      bookings
        .map((b) =>
          b.scheduledFor
            ? b.scheduledFor.getUTCHours() * 60 + b.scheduledFor.getUTCMinutes()
            : null,
        )
        .filter((m): m is number => m !== null),
    );

    const slots: { start: string; end: string }[] = [];
    for (let m = startMinutes; m + SLOT_MINUTES <= endMinutes; m += SLOT_MINUTES) {
      // A booking anywhere inside the slot consumes it.
      const taken = [...bookedMinutes].some(
        (b) => b >= m && b < m + SLOT_MINUTES,
      );
      if (taken) continue;
      slots.push({ start: formatClock(m), end: formatClock(m + SLOT_MINUTES) });
    }

    return slots;
  }
}

// ─────────────────────────── Subscriptions ───────────────────────────

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  async findByUserId(userId: string): Promise<Subscription | null> {
    const row = await prisma.subscription.findUnique({ where: { userId } });
    return row ? toSubscription(row) : null;
  }

  async findByPaymentId(paymentId: string): Promise<Subscription | null> {
    const row = await prisma.subscription.findFirst({
      where: { razorpayPaymentId: paymentId },
    });
    return row ? toSubscription(row) : null;
  }

  async findByOrderId(orderId: string): Promise<Subscription | null> {
    const row = await prisma.subscription.findFirst({
      where: { razorpayOrderId: orderId },
    });
    return row ? toSubscription(row) : null;
  }

  async createOrder(
    userId: string,
    tier: SubscriptionTier,
    razorpayOrderId: string,
  ): Promise<Subscription> {
    // Record WHICH tier this checkout is for, on `pendingTier`. Two bugs are
    // being avoided here:
    //   - the requested tier used to be discarded entirely, so activation
    //     granted whatever was already there — a user could pay for elite and
    //     receive nothing;
    //   - `status` used to be set to "pending", which downgraded a live
    //     subscriber the moment they opened the upgrade page.
    // Neither `tier` nor `status` is touched: only the verified webhook grants.
    const row = await prisma.subscription.upsert({
      where: { userId },
      create: { userId, pendingTier: tier, razorpayOrderId },
      update: { pendingTier: tier, razorpayOrderId },
    });
    return toSubscription(row);
  }

  async activateFromPayment(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    periodEnd: Date,
  ): Promise<Subscription> {
    const existing = await prisma.subscription.findFirst({
      where: { razorpayOrderId },
    });
    if (!existing) {
      throw new Error(`No subscription found for order ${razorpayOrderId}`);
    }

    // Grant the tier that was actually paid for. Falling back to the existing
    // tier only if no pending tier was recorded.
    const grantedTier = (existing.pendingTier ??
      existing.tier) as SubscriptionTier;

    // Money path: the subscription row and the user's premium flag must land
    // together, or a paid user can be left without the entitlement they bought.
    const [row] = await prisma.$transaction([
      prisma.subscription.update({
        where: { id: existing.id },
        data: {
          tier: grantedTier,
          pendingTier: null,
          status: "active",
          razorpayPaymentId,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
        },
      }),
      prisma.user.update({
        where: { id: existing.userId },
        data: { isPremium: grantedTier !== "free" },
      }),
    ]);

    return toSubscription(row);
  }

  async cancelAtPeriodEnd(userId: string): Promise<Subscription> {
    const row = await prisma.subscription.update({
      where: { userId },
      data: { cancelAtPeriodEnd: true },
    });
    return toSubscription(row);
  }

  async revenueSummary(): Promise<
    { tier: SubscriptionTier; count: number; mrr: number }[]
  > {
    const grouped = await prisma.subscription.groupBy({
      by: ["tier"],
      where: { status: "active" },
      _count: { _all: true },
    });

    return grouped.map((g) => {
      const tier = g.tier as SubscriptionTier;
      return {
        tier,
        count: g._count._all,
        // Rupees, not paise — this feeds a display, not a charge.
        mrr: (SUBSCRIPTION_PRICES[tier] / 100) * g._count._all,
      };
    });
  }
}

// ─────────────────────────── Analytics ───────────────────────────

export class PrismaAnalyticsRepository implements AnalyticsRepository {
  async recordProfileView(subjectId: string, viewerId?: string): Promise<void> {
    // Self-views are not analytics.
    if (viewerId && viewerId === subjectId) return;
    await prisma.profileView.create({
      data: { subjectId, viewerId: viewerId ?? null },
    });
  }

  async providerAnalytics(
    providerId: string,
    days = 30,
  ): Promise<ProviderAnalytics> {
    // Anchor to a day boundary and include today. Previously `since` was an
    // arbitrary time-of-day and the bucket loop stopped at yesterday, so
    // today's rows were counted in the headline number but silently dropped
    // from the series — the chart and the total permanently disagreed.
    const since = startOfDay(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));

    const [views, viewRows, quotesSent, quotesAccepted, completed, earnings, user] =
      await Promise.all([
        prisma.profileView.count({
          where: { subjectId: providerId, createdAt: { gte: since } },
        }),
        prisma.profileView.findMany({
          where: { subjectId: providerId, createdAt: { gte: since } },
          select: { createdAt: true },
        }),
        prisma.quote.count({ where: { senderId: providerId } }),
        prisma.quote.count({
          where: { senderId: providerId, status: "accepted" },
        }),
        prisma.booking.count({
          where: { providerId, status: "completed" },
        }),
        prisma.booking.aggregate({
          where: { providerId, status: "completed" },
          _sum: { amount: true },
        }),
        prisma.user.findUnique({
          where: { id: providerId },
          select: { rating: true },
        }),
      ]);

    // Bucket views by day so the chart has a point per day, including zeros.
    const counts = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      counts.set(isoDay(d), 0);
    }
    for (const v of viewRows) {
      const key = isoDay(v.createdAt);
      if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return {
      profileViews: views,
      profileViewsSeries: [...counts.entries()].map(([date, count]) => ({
        date,
        count,
      })),
      quotesSent,
      quotesAccepted,
      acceptanceRate: quotesSent > 0 ? quotesAccepted / quotesSent : 0,
      completedBookings: completed,
      totalEarnings: earnings._sum.amount ?? 0,
      averageRating: user?.rating ?? 0,
    };
  }

  async growthSeries(days: number): Promise<
    { date: string; users: number; requirements: number; bookings: number }[]
  > {
    // Same off-by-one fix as providerAnalytics: anchor to a day boundary and
    // include today, or today's signups vanish from the admin growth chart.
    const since = startOfDay(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));

    const [users, requirements, bookings] = await Promise.all([
      prisma.user.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.requirement.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.booking.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true },
      }),
    ]);

    const series = new Map<
      string,
      { date: string; users: number; requirements: number; bookings: number }
    >();
    for (let i = 0; i < days; i++) {
      const key = isoDay(new Date(since.getTime() + i * 24 * 60 * 60 * 1000));
      series.set(key, { date: key, users: 0, requirements: 0, bookings: 0 });
    }

    const bump = (
      rows: { createdAt: Date }[],
      field: "users" | "requirements" | "bookings",
    ) => {
      for (const r of rows) {
        const entry = series.get(isoDay(r.createdAt));
        if (entry) entry[field] += 1;
      }
    };

    bump(users, "users");
    bump(requirements, "requirements");
    bump(bookings, "bookings");

    return [...series.values()];
  }
}
