import { prisma } from "@/lib/db/client";
import {
  SYSTEM_ACTOR,
  assertAdmin,
  assertSelfOrAdmin,
  type Actor,
} from "../authorize";
import type {
  CreateDisputeInput,
  CreateVerificationInput,
  DisputeRepository,
  ListDisputesFilter,
  ModerationRepository,
  VerificationRepository,
} from "../interfaces";
import {
  normalizePageParams,
  type Dispute,
  type DisputeStatus,
  type Page,
  type PageParams,
  type Report,
  type VerificationRequest,
  type VerificationStatus,
} from "../types";
import { joinList, splitList, toDispute, toReport, toVerificationRequest } from "./mappers";

// ─────────────────────────── Disputes ───────────────────────────

const DISPUTE_INCLUDE = {
  raisedBy: { select: { id: true, name: true, avatarUrl: true } },
  booking: {
    select: { id: true, amount: true, customerId: true, providerId: true },
  },
} as const;

export class PrismaDisputeRepository implements DisputeRepository {
  async create(input: CreateDisputeInput): Promise<Dispute> {
    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      select: { status: true },
    });
    if (!booking) throw new Error("Booking not found");

    // Remember where the booking was so resolve() can put it back.
    //
    // If the booking is already disputed, inherit the prior status from the
    // existing open dispute rather than storing null — storing null made
    // resolve() fall back to "completed", which is the exact outcome this
    // column exists to prevent (a cancelled booking resolving to completed).
    let previousBookingStatus: string | null = booking.status;
    if (booking.status === "disputed") {
      const openDispute = await prisma.dispute.findFirst({
        where: {
          bookingId: input.bookingId,
          status: { in: ["open", "under_review"] },
          previousBookingStatus: { not: null },
        },
        select: { previousBookingStatus: true },
        orderBy: { createdAt: "asc" },
      });
      previousBookingStatus = openDispute?.previousBookingStatus ?? null;
    }

    const [row] = await prisma.$transaction([
      prisma.dispute.create({
        data: {
          bookingId: input.bookingId,
          raisedById: input.raisedById,
          reason: input.reason,
          details: input.details,
          evidenceUrls: joinList(input.evidenceUrls),
          previousBookingStatus,
        },
        include: DISPUTE_INCLUDE,
      }),
      // Raising a dispute moves the booking out of its normal lifecycle.
      prisma.booking.update({
        where: { id: input.bookingId },
        data: { status: "disputed" },
      }),
    ]);
    return toDispute(row);
  }

  async findById(id: string): Promise<Dispute | null> {
    const row = await prisma.dispute.findUnique({
      where: { id },
      include: DISPUTE_INCLUDE,
    });
    return row ? toDispute(row) : null;
  }

  async list(filter: ListDisputesFilter = {}): Promise<Page<Dispute>> {
    const { limit, offset } = normalizePageParams(filter);
    const where = {
      ...(filter.status && { status: filter.status }),
      ...(filter.raisedById && { raisedById: filter.raisedById }),
      ...(filter.bookingId && { bookingId: filter.bookingId }),
    };

    const [items, total] = await Promise.all([
      prisma.dispute.findMany({
        where,
        include: DISPUTE_INCLUDE,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.dispute.count({ where }),
    ]);

    return { items: items.map(toDispute), total, limit, offset };
  }

  async addEvidence(
    id: string,
    urls: string[],
    actor: Actor,
  ): Promise<Dispute> {
    const existing = await prisma.dispute.findUnique({
      where: { id },
      select: { evidenceUrls: true, raisedById: true },
    });
    if (!existing) throw new Error("Dispute not found");
    // Only the person who raised it (or an admin) may add to it.
    assertSelfOrAdmin(actor, existing.raisedById, "dispute.addEvidence");
    const merged = [...splitList(existing?.evidenceUrls ?? null), ...urls];

    const row = await prisma.dispute.update({
      where: { id },
      data: { evidenceUrls: joinList(merged) },
      include: DISPUTE_INCLUDE,
    });
    return toDispute(row);
  }

  async resolve(
    id: string,
    resolution: string,
    actor: Actor,
    status: Extract<DisputeStatus, "resolved" | "rejected">,
  ): Promise<Dispute> {
    assertAdmin(actor, "dispute.resolve");
    const resolvedById = actor === SYSTEM_ACTOR ? null : actor.id;
    const existing = await prisma.dispute.findUnique({
      where: { id },
      select: { bookingId: true, previousBookingStatus: true, status: true },
    });
    if (!existing) throw new Error("Dispute not found");
    if (existing.status === "resolved" || existing.status === "rejected") {
      throw new Error("Dispute is already closed");
    }

    // Only un-dispute the booking once NO other dispute on it is still open.
    // Closing one of two open disputes used to clear the disputed status while
    // the other was still awaiting review.
    const otherOpen = await prisma.dispute.count({
      where: {
        bookingId: existing.bookingId,
        id: { not: id },
        status: { in: ["open", "under_review"] },
      },
    });

    // Restore the booking to where it was before the dispute. Falling back to
    // "completed" only when the prior status is genuinely unknown.
    const restoredStatus = existing.previousBookingStatus ?? "completed";

    const updateDispute = prisma.dispute.update({
      where: { id },
      data: { status, resolution, resolvedById, resolvedAt: new Date() },
      include: DISPUTE_INCLUDE,
    });

    const [row] =
      otherOpen > 0
        ? [await updateDispute]
        : await prisma.$transaction([
            updateDispute,
            prisma.booking.update({
              where: { id: existing.bookingId },
              data: { status: restoredStatus },
            }),
          ]);

    return toDispute(row);
  }

  countOpen(): Promise<number> {
    return prisma.dispute.count({
      where: { status: { in: ["open", "under_review"] } },
    });
  }
}

// ─────────────────────────── Verification (KYC) ───────────────────────────

const VERIFICATION_INCLUDE = {
  user: {
    select: { id: true, name: true, email: true, role: true, avatarUrl: true },
  },
} as const;

export class PrismaVerificationRepository implements VerificationRepository {
  async create(input: CreateVerificationInput): Promise<VerificationRequest> {
    const row = await prisma.verificationRequest.create({
      data: {
        userId: input.userId,
        docType: input.docType,
        docUrls: joinList(input.docUrls) ?? "",
      },
      include: VERIFICATION_INCLUDE,
    });
    return toVerificationRequest(row);
  }

  async findById(id: string): Promise<VerificationRequest | null> {
    const row = await prisma.verificationRequest.findUnique({
      where: { id },
      include: VERIFICATION_INCLUDE,
    });
    return row ? toVerificationRequest(row) : null;
  }

  async findLatestForUser(
    userId: string,
  ): Promise<VerificationRequest | null> {
    const row = await prisma.verificationRequest.findFirst({
      where: { userId },
      include: VERIFICATION_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return row ? toVerificationRequest(row) : null;
  }

  async listQueue(
    filter: PageParams & { status?: VerificationStatus } = {},
  ): Promise<Page<VerificationRequest>> {
    const { limit, offset } = normalizePageParams(filter);
    const where = { status: filter.status ?? "pending" };

    const [items, total] = await Promise.all([
      prisma.verificationRequest.findMany({
        where,
        include: VERIFICATION_INCLUDE,
        orderBy: { createdAt: "asc" }, // oldest first — it's a queue
        take: limit,
        skip: offset,
      }),
      prisma.verificationRequest.count({ where }),
    ]);

    return { items: items.map(toVerificationRequest), total, limit, offset };
  }

  async approve(
    id: string,
    actor: Actor,
    note?: string,
  ): Promise<VerificationRequest> {
    assertAdmin(actor, "verification.approve");
    const reviewedById = actor === SYSTEM_ACTOR ? null : actor.id;
    const existing = await prisma.verificationRequest.findUnique({
      where: { id },
      select: { userId: true, status: true },
    });
    if (!existing) throw new Error("Verification request not found");
    if (existing.status !== "pending") {
      throw new Error(`Verification request is already ${existing.status}`);
    }

    // Approval is what actually grants the verified badge, so the two writes
    // must land together — a half-applied approval leaves an approved request
    // against an unverified user.
    const [row] = await prisma.$transaction([
      prisma.verificationRequest.update({
        where: { id },
        data: {
          status: "approved",
          reviewedById,
          reviewNote: note ?? null,
          reviewedAt: new Date(),
        },
        include: VERIFICATION_INCLUDE,
      }),
      prisma.user.update({
        where: { id: existing.userId },
        data: { isVerified: true },
      }),
    ]);

    return toVerificationRequest(row);
  }

  async reject(
    id: string,
    actor: Actor,
    note: string,
  ): Promise<VerificationRequest> {
    assertAdmin(actor, "verification.reject");
    const reviewedById = actor === SYSTEM_ACTOR ? null : actor.id;
    const existing = await prisma.verificationRequest.findUnique({
      where: { id },
      select: { userId: true, status: true },
    });
    if (!existing) throw new Error("Verification request not found");
    if (existing.status === "rejected") {
      throw new Error("Verification request is already rejected");
    }

    // Rejecting must also REVOKE the badge. Previously reject() only wrote the
    // request row, so an approve-then-reject left the user permanently
    // verified while the audit trail read "rejected".
    const [row] = await prisma.$transaction([
      prisma.verificationRequest.update({
        where: { id },
        data: {
          status: "rejected",
          reviewedById,
          reviewNote: note,
          reviewedAt: new Date(),
        },
        include: VERIFICATION_INCLUDE,
      }),
      prisma.user.update({
        where: { id: existing.userId },
        data: { isVerified: false },
      }),
    ]);

    return toVerificationRequest(row);
  }

  countPending(): Promise<number> {
    return prisma.verificationRequest.count({ where: { status: "pending" } });
  }
}

// ─────────────────────────── Moderation ───────────────────────────

export class PrismaModerationRepository implements ModerationRepository {
  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    await prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await prisma.block.deleteMany({ where: { blockerId, blockedId } });
  }

  async listBlocked(blockerId: string): Promise<string[]> {
    const rows = await prisma.block.findMany({
      where: { blockerId },
      select: { blockedId: true },
    });
    return rows.map((r) => r.blockedId);
  }

  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    // Blocking is symmetric for message delivery: either direction blocks.
    const count = await prisma.block.count({
      where: {
        OR: [
          { blockerId, blockedId },
          { blockerId: blockedId, blockedId: blockerId },
        ],
      },
    });
    return count > 0;
  }

  async createReport(input: {
    reporterId: string;
    reportedId: string;
    targetType: string;
    targetId?: string;
    reason: string;
    details?: string;
  }): Promise<Report> {
    const row = await prisma.report.create({
      data: {
        reporterId: input.reporterId,
        reportedId: input.reportedId,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        reason: input.reason,
        details: input.details ?? null,
      },
    });

    // Reporting a message flags it for the moderation queue immediately.
    if (input.targetType === "message" && input.targetId) {
      await prisma.message
        .update({ where: { id: input.targetId }, data: { isFlagged: true } })
        .catch(() => {
          // Message may already be hard-deleted; the report still stands.
        });
    }

    return toReport(row);
  }

  async listReports(
    filter: PageParams & { status?: string } = {},
  ): Promise<Page<Report>> {
    const { limit, offset } = normalizePageParams(filter);
    const where = { ...(filter.status && { status: filter.status }) };

    const [items, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.report.count({ where }),
    ]);

    return { items: items.map(toReport), total, limit, offset };
  }

  async resolveReport(id: string, actor: Actor): Promise<Report> {
    assertAdmin(actor, "resolveReport");
    const row = await prisma.report.update({
      where: { id },
      data: { status: "resolved", resolvedAt: new Date() },
    });
    return toReport(row);
  }
}
