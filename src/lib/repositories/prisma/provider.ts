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

/** Normalises a date to UTC midnight so blocked-date lookups are exact. */
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

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

    // Hourly slots across the working window, minus hours already booked.
    const bookedHours = new Set(
      bookings
        .map((b) => b.scheduledFor?.getUTCHours())
        .filter((h): h is number => h !== undefined),
    );

    const startHour = Number(hours.startTime.split(":")[0]);
    const endHour = Number(hours.endTime.split(":")[0]);
    const slots: { start: string; end: string }[] = [];

    for (let h = startHour; h < endHour; h++) {
      if (bookedHours.has(h)) continue;
      slots.push({
        start: `${String(h).padStart(2, "0")}:00`,
        end: `${String(h + 1).padStart(2, "0")}:00`,
      });
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

  async createOrder(
    userId: string,
    tier: SubscriptionTier,
    razorpayOrderId: string,
  ): Promise<Subscription> {
    // The pending order is recorded but the tier is NOT granted here — only the
    // verified webhook may do that. See activateFromPayment.
    const row = await prisma.subscription.upsert({
      where: { userId },
      create: { userId, tier: "free", status: "pending", razorpayOrderId },
      update: { status: "pending", razorpayOrderId },
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

    const row = await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        status: "active",
        razorpayPaymentId,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      },
    });

    await prisma.user.update({
      where: { id: row.userId },
      data: { isPremium: row.tier !== "free" },
    });

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
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

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
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

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
