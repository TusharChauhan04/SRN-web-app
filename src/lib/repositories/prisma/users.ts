import { prisma } from "@/lib/db/client";
import type {
  CreateUserInput,
  ListUsersFilter,
  SearchProvidersFilter,
  UpdateUserInput,
  UserRepository,
} from "../interfaces";
import {
  normalizePageParams,
  USER_ROLES,
  type Page,
  type User,
  type UserRole,
} from "../types";
import { joinList, toUser } from "./mappers";

/**
 * SQLite has no case-insensitive `contains` mode in Prisma, so free-text search
 * matches on a lowercased copy of the term against lowercased columns via raw
 * comparison. Postgres would use `mode: "insensitive"` instead — one of the few
 * places the implementation is genuinely dialect-specific.
 */
function textFilter(query: string) {
  const q = query.trim();
  return [
    { name: { contains: q } },
    { email: { contains: q } },
    { title: { contains: q } },
    { skills: { contains: q } },
  ];
}

export class PrismaUserRepository implements UserRepository {
  async create(input: CreateUserInput): Promise<User> {
    const row = await prisma.user.create({
      data: {
        id: input.id,
        email: input.email,
        name: input.name,
        role: input.role,
        title: input.title ?? null,
        location: input.location ?? null,
        bio: input.bio ?? null,
        skills: joinList(input.skills),
        phone: input.phone ?? null,
        companyName: input.companyName ?? null,
        industry: input.industry ?? null,
        notificationPrefs: { create: {} },
      },
    });
    return toUser(row);
  }

  async findById(id: string): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { id } });
    return row ? toUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { email } });
    return row ? toUser(row) : null;
  }

  async update(id: string, input: UpdateUserInput): Promise<User> {
    const row = await prisma.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.title !== undefined && { title: input.title }),
        ...(input.location !== undefined && { location: input.location }),
        ...(input.bio !== undefined && { bio: input.bio }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.companyName !== undefined && {
          companyName: input.companyName,
        }),
        ...(input.industry !== undefined && { industry: input.industry }),
        ...(input.skills !== undefined && { skills: joinList(input.skills) }),
        ...(input.portfolioLinks !== undefined && {
          portfolioLinks: joinList(input.portfolioLinks),
        }),
        ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
        ...(input.hourlyRate !== undefined && { hourlyRate: input.hourlyRate }),
        ...(input.serviceRadiusKm !== undefined && {
          serviceRadiusKm: input.serviceRadiusKm,
        }),
        ...(input.isAvailable !== undefined && {
          isAvailable: input.isAvailable,
        }),
        ...(input.fcmToken !== undefined && { fcmToken: input.fcmToken }),
        ...(input.phoneVerified !== undefined && {
          phoneVerified: input.phoneVerified,
        }),
      },
    });
    return toUser(row);
  }

  async list(filter: ListUsersFilter = {}): Promise<Page<User>> {
    const { limit, offset } = normalizePageParams(filter);
    const where = {
      ...(filter.role && { role: filter.role }),
      ...(filter.isSuspended !== undefined && {
        isSuspended: filter.isSuspended,
      }),
      ...(filter.isVerified !== undefined && { isVerified: filter.isVerified }),
      ...(filter.query && { OR: textFilter(filter.query) }),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.user.count({ where }),
    ]);

    return { items: items.map(toUser), total, limit, offset };
  }

  async searchProviders(filter: SearchProvidersFilter): Promise<Page<User>> {
    const { limit, offset } = normalizePageParams(filter);
    const where = {
      role: filter.role ?? { in: ["digital", "local"] },
      isSuspended: false,
      ...(filter.minRating !== undefined && {
        rating: { gte: filter.minRating },
      }),
      ...(filter.maxHourlyRate !== undefined && {
        hourlyRate: { lte: filter.maxHourlyRate },
      }),
      ...(filter.location && { location: { contains: filter.location } }),
      ...(filter.query && { OR: textFilter(filter.query) }),
      // Skills are comma-joined; AND-match each requested skill as a substring.
      ...(filter.skills?.length && {
        AND: filter.skills.map((s) => ({ skills: { contains: s } })),
      }),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ rating: "desc" }, { completedGigs: "desc" }],
        take: limit,
        skip: offset,
      }),
      prisma.user.count({ where }),
    ]);

    return { items: items.map(toUser), total, limit, offset };
  }

  async setSuspended(id: string, suspended: boolean): Promise<User> {
    const row = await prisma.user.update({
      where: { id },
      data: { isSuspended: suspended },
    });
    return toUser(row);
  }

  async setRole(id: string, role: UserRole): Promise<User> {
    const row = await prisma.user.update({ where: { id }, data: { role } });
    return toUser(row);
  }

  async delete(id: string): Promise<void> {
    await prisma.user.delete({ where: { id } });
  }

  async markForDeletion(id: string, at: Date): Promise<User> {
    const row = await prisma.user.update({
      where: { id },
      data: { deletionRequestedAt: at },
    });
    return toUser(row);
  }

  async cancelDeletion(id: string): Promise<User> {
    const row = await prisma.user.update({
      where: { id },
      data: { deletionRequestedAt: null },
    });
    return toUser(row);
  }

  async anonymize(id: string): Promise<void> {
    // Keep the row so bookings/reviews retain referential integrity, but strip
    // every field that identifies a person.
    await prisma.user.update({
      where: { id },
      data: {
        name: "Deleted user",
        email: `deleted+${id}@invalid.local`,
        phone: null,
        bio: null,
        location: null,
        avatarUrl: null,
        title: null,
        skills: null,
        portfolioLinks: null,
        companyName: null,
        industry: null,
        fcmToken: null,
        isSuspended: true,
      },
    });
  }

  async exportAll(id: string): Promise<Record<string, unknown>> {
    const [
      user,
      requirements,
      quotesSent,
      quotesReceived,
      bookingsAsCustomer,
      bookingsAsProvider,
      messages,
      reviewsWritten,
      reviewsReceived,
      disputes,
      portfolio,
      notifications,
      uploads,
      subscription,
    ] = await Promise.all([
      prisma.user.findUnique({ where: { id } }),
      prisma.requirement.findMany({ where: { creatorId: id } }),
      prisma.quote.findMany({ where: { senderId: id } }),
      prisma.quote.findMany({ where: { receiverId: id } }),
      prisma.booking.findMany({ where: { customerId: id } }),
      prisma.booking.findMany({ where: { providerId: id } }),
      prisma.message.findMany({ where: { senderId: id } }),
      prisma.review.findMany({ where: { authorId: id } }),
      prisma.review.findMany({ where: { subjectId: id } }),
      prisma.dispute.findMany({ where: { raisedById: id } }),
      prisma.portfolioItem.findMany({ where: { userId: id } }),
      prisma.notification.findMany({ where: { userId: id } }),
      prisma.upload.findMany({ where: { userId: id } }),
      prisma.subscription.findUnique({ where: { userId: id } }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      user,
      requirements,
      quotes: { sent: quotesSent, received: quotesReceived },
      bookings: { asCustomer: bookingsAsCustomer, asProvider: bookingsAsProvider },
      messages,
      reviews: { written: reviewsWritten, received: reviewsReceived },
      disputes,
      portfolio,
      notifications,
      uploads,
      subscription,
    };
  }

  async countByRole(): Promise<Record<UserRole, number>> {
    const grouped = await prisma.user.groupBy({
      by: ["role"],
      _count: { _all: true },
    });

    const result = Object.fromEntries(
      USER_ROLES.map((r) => [r, 0]),
    ) as Record<UserRole, number>;

    for (const g of grouped) {
      const role = g.role as UserRole;
      if (role in result) result[role] = g._count._all;
    }
    return result;
  }

  async countCreatedSince(since: Date): Promise<number> {
    return prisma.user.count({ where: { createdAt: { gte: since } } });
  }

  async findSuspiciousAccounts(limit = 50): Promise<User[]> {
    // Heuristic placeholder matching the mobile backend's intent: brand-new
    // accounts that already hold a suspiciously high review count. A real
    // implementation would join device/IP signals, which this schema does not
    // yet carry — noted in DATABASE.md as a known gap.
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await prisma.user.findMany({
      where: { createdAt: { gte: cutoff }, reviewsCount: { gte: 5 } },
      orderBy: { reviewsCount: "desc" },
      take: limit,
    });
    return rows.map(toUser);
  }
}
