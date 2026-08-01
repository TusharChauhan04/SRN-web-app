import { prisma } from "@/lib/db/client";
import { assertAdmin, assertSelfOrAdmin, type Actor } from "../authorize";
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
  type PublicUser,
  type User,
  type UserRole,
} from "../types";
import {
  PUBLIC_USER_SELECT,
  joinList,
  splitList,
  toPublicUser,
  toUser,
} from "./mappers";
import { listTokenMatch, sanitizeSearchTerm, searchTerm } from "./query";

/**
 * Free-text match across the *public* profile columns.
 *
 * `email` is deliberately NOT searched. It used to be, which meant a query of
 * "@company.com" both filtered by and returned other people's addresses — a
 * ready-made harvesting endpoint on the public provider search.
 *
 * Case sensitivity: this relies on SQLite's LIKE being ASCII-case-insensitive
 * by default. On Postgres each clause needs `mode: "insensitive"` explicitly —
 * one of the few genuinely dialect-specific spots. Noted in DATABASE.md.
 */
function textFilter(query: string) {
  const q = sanitizeSearchTerm(query);
  return [
    { name: { contains: q } },
    { title: { contains: q } },
    { bio: { contains: q } },
    { location: { contains: q } },
  ];
}

/**
 * Admin-only free-text match, which additionally searches email.
 *
 * Separate from `textFilter` so the public search can never accidentally
 * inherit it.
 */
function adminTextFilter(query: string) {
  const q = sanitizeSearchTerm(query);
  return [...textFilter(query), { email: { contains: q } }];
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
    const query = searchTerm(filter.query);
    // `list` backs the admin users screen, so it may search email.
    const where = {
      ...(filter.role && { role: filter.role }),
      ...(filter.isSuspended !== undefined && {
        isSuspended: filter.isSuspended,
      }),
      ...(filter.isVerified !== undefined && { isVerified: filter.isVerified }),
      ...(query && { OR: adminTextFilter(query) }),
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

  async searchProviders(
    filter: SearchProvidersFilter,
  ): Promise<Page<PublicUser>> {
    const { limit, offset } = normalizePageParams(filter);
    const query = searchTerm(filter.query);
    const where = {
      role: filter.role ?? { in: ["digital", "local"] },
      isSuspended: false,
      ...(filter.minRating !== undefined && {
        rating: { gte: filter.minRating },
      }),
      ...(filter.maxHourlyRate !== undefined && {
        hourlyRate: { lte: filter.maxHourlyRate },
      }),
      ...(filter.location && {
        location: { contains: sanitizeSearchTerm(filter.location) },
      }),
      ...(query && { OR: textFilter(query) }),
      // Exact-token match per skill — an unanchored `contains` matched
      // "javascript" for a search of "java" and "repair" for "air".
      ...(filter.skills?.length && {
        AND: filter.skills.map((s) => ({
          skills: { contains: listTokenMatch(s) },
        })),
      }),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        // Public projection: this is the discovery surface, so email, phone,
        // fcmToken, privileges and deletionRequestedAt must not leave here.
        select: PUBLIC_USER_SELECT,
        orderBy: [{ rating: "desc" }, { completedGigs: "desc" }],
        take: limit,
        skip: offset,
      }),
      prisma.user.count({ where }),
    ]);

    return { items: items.map(toPublicUser), total, limit, offset };
  }

  async setSuspended(
    id: string,
    suspended: boolean,
    actor: Actor,
  ): Promise<User> {
    assertAdmin(actor, "setSuspended");
    const row = await prisma.user.update({
      where: { id },
      data: { isSuspended: suspended },
    });
    return toUser(row);
  }

  async setRole(id: string, role: UserRole, actor: Actor): Promise<User> {
    // Privilege escalation path — admin only, never self-service.
    assertAdmin(actor, "setRole");
    const row = await prisma.user.update({ where: { id }, data: { role } });
    return toUser(row);
  }

  async delete(id: string, actor: Actor): Promise<void> {
    // Hard delete — admin only.
    assertAdmin(actor, "delete user");
    await prisma.user.delete({ where: { id } });
  }

  async markForDeletion(id: string, at: Date, actor: Actor): Promise<User> {
    assertSelfOrAdmin(actor, id, "markForDeletion");
    const row = await prisma.user.update({
      where: { id },
      data: { deletionRequestedAt: at },
    });
    return toUser(row);
  }

  async cancelDeletion(id: string, actor: Actor): Promise<User> {
    assertSelfOrAdmin(actor, id, "cancelDeletion");
    const row = await prisma.user.update({
      where: { id },
      data: { deletionRequestedAt: null },
    });
    return toUser(row);
  }

  async anonymize(id: string, actor: Actor): Promise<void> {
    assertSelfOrAdmin(actor, id, "anonymize");
    // Keep the User row so bookings/reviews retain referential integrity, but
    // strip every field that identifies a person — AND every related row that
    // carries identity. Scrubbing only the User row left the KYC document URLs,
    // uploads, message text and dispute evidence fully intact, so a user who
    // exercised erasure had their name removed from a list view while their
    // passport scan stayed in the bucket.
    await prisma.$transaction([
      prisma.user.update({
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
      }),
      // KYC identity documents.
      prisma.verificationRequest.updateMany({
        where: { userId: id },
        data: { docUrls: "", reviewNote: null },
      }),
      // Free-text the user authored.
      prisma.message.updateMany({
        where: { senderId: id },
        data: { text: "[deleted]", attachmentUrl: null, attachmentName: null },
      }),
      prisma.dispute.updateMany({
        where: { raisedById: id },
        data: { details: "[deleted]", evidenceUrls: null },
      }),
      prisma.report.updateMany({
        where: { reporterId: id },
        data: { details: null },
      }),
      prisma.review.updateMany({
        where: { authorId: id },
        data: { comment: null },
      }),
      prisma.portfolioItem.deleteMany({ where: { userId: id } }),
      // Upload rows go last so the caller can read storageKeys first.
      prisma.upload.deleteMany({ where: { userId: id } }),
    ]);
  }

  /**
   * Storage keys belonging to a user, so the caller can delete the underlying
   * objects before `anonymize` drops the rows that point at them.
   *
   * Erasure is not complete until these are removed from object storage and
   * the Firebase Auth user is deleted — neither of which this repository can
   * do, because both live outside the database. The GDPR handler must do both.
   */
  async listStorageKeys(id: string, actor: Actor): Promise<string[]> {
    assertSelfOrAdmin(actor, id, "listStorageKeys");
    const [uploads, verifications] = await Promise.all([
      prisma.upload.findMany({
        where: { userId: id },
        select: { storageKey: true },
      }),
      prisma.verificationRequest.findMany({
        where: { userId: id },
        select: { docUrls: true },
      }),
    ]);

    return [
      ...uploads.map((u) => u.storageKey),
      ...verifications.flatMap((v) => splitList(v.docUrls)),
    ].filter(Boolean);
  }

  async exportAll(id: string, actor: Actor): Promise<Record<string, unknown>> {
    assertSelfOrAdmin(actor, id, "exportAll");
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
      // Both sides of every conversation — sender-only produced an export
      // containing half of each thread, which is not a complete DSAR answer.
      prisma.message.findMany({
        where: { OR: [{ senderId: id }, { receiverId: id }] },
      }),
      prisma.review.findMany({ where: { authorId: id } }),
      prisma.review.findMany({ where: { subjectId: id } }),
      prisma.dispute.findMany({ where: { raisedById: id } }),
      prisma.portfolioItem.findMany({ where: { userId: id } }),
      prisma.notification.findMany({ where: { userId: id } }),
      prisma.upload.findMany({ where: { userId: id } }),
      prisma.subscription.findUnique({ where: { userId: id } }),
    ]);

    // Everything else the user owns. Omitting these made the bundle incomplete.
    const [
      blocks,
      reports,
      workingHours,
      blockedDates,
      referral,
      presence,
      profileViews,
      auditEvents,
      verificationRequests,
      notificationPrefs,
    ] = await Promise.all([
      prisma.block.findMany({
        where: { OR: [{ blockerId: id }, { blockedId: id }] },
      }),
      prisma.report.findMany({
        where: { OR: [{ reporterId: id }, { reportedId: id }] },
      }),
      prisma.workingHours.findMany({ where: { userId: id } }),
      prisma.blockedDate.findMany({ where: { userId: id } }),
      prisma.referral.findUnique({ where: { userId: id } }),
      prisma.presence.findUnique({ where: { userId: id } }),
      prisma.profileView.findMany({ where: { subjectId: id } }),
      prisma.auditEvent.findMany({ where: { actorId: id } }),
      prisma.verificationRequest.findMany({ where: { userId: id } }),
      prisma.notificationPref.findUnique({ where: { userId: id } }),
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
      blocks,
      reports,
      workingHours,
      blockedDates,
      referral,
      presence,
      profileViews,
      auditEvents,
      verificationRequests,
      notificationPrefs,
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

  async findSuspiciousAccounts(actor: Actor, limit = 50): Promise<User[]> {
    assertAdmin(actor, "findSuspiciousAccounts");
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
