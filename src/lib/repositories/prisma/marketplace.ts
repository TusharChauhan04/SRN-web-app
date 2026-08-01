import { prisma } from "@/lib/db/client";
import type {
  BookingRepository,
  CreateBookingInput,
  CreateQuoteInput,
  CreateRequirementInput,
  CreateReviewInput,
  ListBookingsFilter,
  ListQuotesFilter,
  ListRequirementsFilter,
  ListReviewsFilter,
  QuoteRepository,
  RequirementRepository,
  ReviewRepository,
} from "../interfaces";
import {
  normalizePageParams,
  type Booking,
  type BookingStatus,
  type Page,
  type PageParams,
  type Quote,
  type QuoteStatus,
  type Requirement,
  type RequirementStatus,
  type Review,
} from "../types";
import {
  joinList,
  splitList,
  toBooking,
  toQuote,
  toRequirement,
  toReview,
} from "./mappers";

const CREATOR_SELECT = {
  select: { id: true, name: true, avatarUrl: true, role: true },
} as const;

// ─────────────────────────── Requirements ───────────────────────────

export class PrismaRequirementRepository implements RequirementRepository {
  async create(input: CreateRequirementInput): Promise<Requirement> {
    const [row] = await prisma.$transaction([
      prisma.requirement.create({
        data: {
          creatorId: input.creatorId,
          title: input.title,
          category: input.category,
          description: input.description,
          skillsNeeded: joinList(input.skillsNeeded),
          minBudget: input.minBudget,
          maxBudget: input.maxBudget,
          location: input.location ?? null,
        },
        include: { creator: CREATOR_SELECT },
      }),
      // Keep the denormalised counter the dashboards read in step with reality.
      prisma.user.update({
        where: { id: input.creatorId },
        data: { postedRequirementsCount: { increment: 1 } },
      }),
    ]);
    return toRequirement(row);
  }

  async findById(id: string): Promise<Requirement | null> {
    const row = await prisma.requirement.findUnique({
      where: { id },
      include: { creator: CREATOR_SELECT, _count: { select: { quotes: true } } },
    });
    return row ? toRequirement(row) : null;
  }

  async list(filter: ListRequirementsFilter = {}): Promise<Page<Requirement>> {
    const { limit, offset } = normalizePageParams(filter);
    const where = {
      ...(filter.creatorId && { creatorId: filter.creatorId }),
      ...(filter.status && { status: filter.status }),
      ...(filter.category && { category: filter.category }),
      ...(filter.minBudget !== undefined && {
        maxBudget: { gte: filter.minBudget },
      }),
      ...(filter.maxBudget !== undefined && {
        minBudget: { lte: filter.maxBudget },
      }),
      ...(filter.query && {
        OR: [
          { title: { contains: filter.query } },
          { description: { contains: filter.query } },
          { skillsNeeded: { contains: filter.query } },
        ],
      }),
      ...(filter.skills?.length && {
        AND: filter.skills.map((s) => ({ skillsNeeded: { contains: s } })),
      }),
    };

    const [items, total] = await Promise.all([
      prisma.requirement.findMany({
        where,
        include: {
          creator: CREATOR_SELECT,
          _count: { select: { quotes: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.requirement.count({ where }),
    ]);

    return { items: items.map(toRequirement), total, limit, offset };
  }

  async feedForProvider(
    providerId: string,
    params: PageParams = {},
  ): Promise<Page<Requirement>> {
    const { limit, offset } = normalizePageParams(params);
    const provider = await prisma.user.findUnique({
      where: { id: providerId },
      select: { skills: true },
    });
    const skills = splitList(provider?.skills ?? null);

    // Match on any of the provider's skills; providers with no skills listed
    // see the whole open feed rather than an empty one.
    const where = {
      status: "open",
      ...(skills.length > 0 && {
        OR: skills.map((s) => ({ skillsNeeded: { contains: s } })),
      }),
    };

    const [items, total] = await Promise.all([
      prisma.requirement.findMany({
        where,
        include: {
          creator: CREATOR_SELECT,
          _count: { select: { quotes: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.requirement.count({ where }),
    ]);

    return { items: items.map(toRequirement), total, limit, offset };
  }

  async updateStatus(
    id: string,
    status: RequirementStatus,
  ): Promise<Requirement> {
    const row = await prisma.requirement.update({
      where: { id },
      data: { status },
      include: { creator: CREATOR_SELECT },
    });
    return toRequirement(row);
  }

  async delete(id: string): Promise<void> {
    const existing = await prisma.requirement.findUnique({
      where: { id },
      select: { creatorId: true },
    });
    if (!existing) return;

    await prisma.$transaction([
      prisma.requirement.delete({ where: { id } }),
      prisma.user.update({
        where: { id: existing.creatorId },
        data: { postedRequirementsCount: { decrement: 1 } },
      }),
    ]);
  }

  count(): Promise<number> {
    return prisma.requirement.count();
  }

  countSince(since: Date): Promise<number> {
    return prisma.requirement.count({ where: { createdAt: { gte: since } } });
  }
}

// ─────────────────────────── Quotes ───────────────────────────

const QUOTE_INCLUDE = {
  sender: {
    select: { id: true, name: true, avatarUrl: true, rating: true, title: true },
  },
  requirement: { select: { id: true, title: true, maxBudget: true } },
} as const;

export class PrismaQuoteRepository implements QuoteRepository {
  async create(input: CreateQuoteInput): Promise<Quote> {
    const row = await prisma.quote.create({
      data: {
        requirementId: input.requirementId,
        senderId: input.senderId,
        receiverId: input.receiverId,
        amount: input.amount,
        durationDays: input.durationDays,
        message: input.message ?? null,
        counterOfQuoteId: input.counterOfQuoteId ?? null,
      },
      include: QUOTE_INCLUDE,
    });
    return toQuote(row);
  }

  async findById(id: string): Promise<Quote | null> {
    const row = await prisma.quote.findUnique({
      where: { id },
      include: QUOTE_INCLUDE,
    });
    return row ? toQuote(row) : null;
  }

  async list(filter: ListQuotesFilter = {}): Promise<Page<Quote>> {
    const { limit, offset } = normalizePageParams(filter);
    const where = {
      ...(filter.requirementId && { requirementId: filter.requirementId }),
      ...(filter.senderId && { senderId: filter.senderId }),
      ...(filter.receiverId && { receiverId: filter.receiverId }),
      ...(filter.status && { status: filter.status }),
    };

    const [items, total] = await Promise.all([
      prisma.quote.findMany({
        where,
        include: QUOTE_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.quote.count({ where }),
    ]);

    return { items: items.map(toQuote), total, limit, offset };
  }

  async updateStatus(id: string, status: QuoteStatus): Promise<Quote> {
    const row = await prisma.quote.update({
      where: { id },
      data: { status },
      include: QUOTE_INCLUDE,
    });
    return toQuote(row);
  }

  async shortlist(requirementId: string, quoteId: string): Promise<Quote> {
    const row = await prisma.quote.update({
      where: { id: quoteId },
      data: { status: "shortlisted" },
      include: QUOTE_INCLUDE,
    });
    // Guard against a quote id from a different requirement being shortlisted.
    if (row.requirementId !== requirementId) {
      throw new Error("Quote does not belong to this requirement");
    }
    return toQuote(row);
  }

  async delete(id: string): Promise<void> {
    await prisma.quote.delete({ where: { id } });
  }

  async existsForSenderOnRequirement(
    senderId: string,
    requirementId: string,
  ): Promise<boolean> {
    const count = await prisma.quote.count({
      where: {
        senderId,
        requirementId,
        status: { notIn: ["withdrawn", "rejected"] },
      },
    });
    return count > 0;
  }

  count(): Promise<number> {
    return prisma.quote.count();
  }
}

// ─────────────────────────── Bookings ───────────────────────────

const BOOKING_INCLUDE = {
  customer: { select: { id: true, name: true, avatarUrl: true } },
  provider: { select: { id: true, name: true, avatarUrl: true } },
  requirement: { select: { id: true, title: true } },
  review: { select: { id: true } },
} as const;

export class PrismaBookingRepository implements BookingRepository {
  async create(input: CreateBookingInput): Promise<Booking> {
    const row = await prisma.booking.create({
      data: {
        quoteId: input.quoteId ?? null,
        requirementId: input.requirementId ?? null,
        customerId: input.customerId,
        providerId: input.providerId,
        amount: input.amount,
        scheduledFor: input.scheduledFor ?? null,
      },
      include: BOOKING_INCLUDE,
    });
    return toBooking(row);
  }

  async findById(id: string): Promise<Booking | null> {
    const row = await prisma.booking.findUnique({
      where: { id },
      include: BOOKING_INCLUDE,
    });
    return row ? toBooking(row) : null;
  }

  async list(filter: ListBookingsFilter = {}): Promise<Page<Booking>> {
    const { limit, offset } = normalizePageParams(filter);
    const where = {
      ...(filter.customerId && { customerId: filter.customerId }),
      ...(filter.providerId && { providerId: filter.providerId }),
      ...(filter.status && { status: filter.status }),
    };

    const [items, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: BOOKING_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.booking.count({ where }),
    ]);

    return { items: items.map(toBooking), total, limit, offset };
  }

  async updateStatus(id: string, status: BookingStatus): Promise<Booking> {
    const row = await prisma.booking.update({
      where: { id },
      data: {
        status,
        // Completion time is derived from the transition, not caller-supplied,
        // so it can't be back-dated by a client.
        ...(status === "completed" && { completedAt: new Date() }),
      },
      include: BOOKING_INCLUDE,
    });

    if (status === "completed") {
      await prisma.user.update({
        where: { id: row.providerId },
        data: { completedGigs: { increment: 1 } },
      });
    }
    return toBooking(row);
  }

  async findByProviderOnDate(
    providerId: string,
    date: Date,
  ): Promise<Booking[]> {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const rows = await prisma.booking.findMany({
      where: {
        providerId,
        scheduledFor: { gte: start, lt: end },
        status: { notIn: ["cancelled"] },
      },
      include: BOOKING_INCLUDE,
    });
    return rows.map(toBooking);
  }

  count(): Promise<number> {
    return prisma.booking.count();
  }

  async sumCompletedAmount(providerId?: string): Promise<number> {
    const result = await prisma.booking.aggregate({
      where: { status: "completed", ...(providerId && { providerId }) },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }
}

// ─────────────────────────── Reviews ───────────────────────────

const REVIEW_INCLUDE = {
  author: { select: { id: true, name: true, avatarUrl: true } },
} as const;

export class PrismaReviewRepository implements ReviewRepository {
  async create(input: CreateReviewInput): Promise<Review> {
    const row = await prisma.review.create({
      data: {
        bookingId: input.bookingId,
        authorId: input.authorId,
        subjectId: input.subjectId,
        rating: input.rating,
        comment: input.comment ?? null,
      },
      include: REVIEW_INCLUDE,
    });
    await this.recomputeSubjectRating(input.subjectId);
    return toReview(row);
  }

  async findById(id: string): Promise<Review | null> {
    const row = await prisma.review.findUnique({
      where: { id },
      include: REVIEW_INCLUDE,
    });
    return row ? toReview(row) : null;
  }

  async findByBookingId(bookingId: string): Promise<Review | null> {
    const row = await prisma.review.findUnique({
      where: { bookingId },
      include: REVIEW_INCLUDE,
    });
    return row ? toReview(row) : null;
  }

  async list(filter: ListReviewsFilter = {}): Promise<Page<Review>> {
    const { limit, offset } = normalizePageParams(filter);
    const where = {
      ...(filter.subjectId && { subjectId: filter.subjectId }),
      ...(filter.authorId && { authorId: filter.authorId }),
      ...(filter.isFlagged !== undefined && { isFlagged: filter.isFlagged }),
    };

    const [items, total] = await Promise.all([
      prisma.review.findMany({
        where,
        include: REVIEW_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.review.count({ where }),
    ]);

    return { items: items.map(toReview), total, limit, offset };
  }

  async delete(id: string): Promise<void> {
    const existing = await prisma.review.findUnique({
      where: { id },
      select: { subjectId: true },
    });
    await prisma.review.delete({ where: { id } });
    if (existing) await this.recomputeSubjectRating(existing.subjectId);
  }

  async recomputeSubjectRating(subjectId: string): Promise<void> {
    const agg = await prisma.review.aggregate({
      where: { subjectId },
      _avg: { rating: true },
      _count: { _all: true },
    });
    await prisma.user.update({
      where: { id: subjectId },
      data: {
        rating: agg._avg.rating ?? 0,
        reviewsCount: agg._count._all,
      },
    });
  }

  async findSuspicious(limit = 50): Promise<Review[]> {
    // Mirrors the mobile backend's fraud view: already-flagged reviews first,
    // then 5-star reviews with no written comment, which is the cheapest
    // signal for bought ratings available in this schema.
    const rows = await prisma.review.findMany({
      where: {
        OR: [{ isFlagged: true }, { rating: 5, comment: null }],
      },
      include: REVIEW_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toReview);
  }
}
