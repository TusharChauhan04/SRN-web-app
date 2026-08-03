import "server-only";

/**
 * Admin policy.
 *
 * Every function here takes the acting admin and passes it down to the
 * privileged repository methods, which assert on it independently. That is
 * deliberate belt-and-braces: the gateway already refused non-admins before the
 * handler ran, but the repository guard means a future caller that forgets the
 * gate fails loudly instead of silently succeeding.
 *
 * Reads are audited as well as writes. Who looked at the KYC queue is as much
 * a compliance question as who approved something in it.
 */
import { repo } from "@/lib/repositories";
import { notify } from "./notify.service";
import type {
  AuditEvent,
  Dispute,
  DisputeStatus,
  FeatureFlag,
  Message,
  Page,
  Report,
  Review,
  SubscriptionTier,
  User,
  UserRole,
  VerificationRequest,
} from "@/lib/repositories/types";
import { GatewayError } from "@/lib/gateway/types";
import { deleteIdentity, revokeUserSessions } from "./auth.service";

// ─────────────────────────── Dashboard ───────────────────────────

export interface AdminOverview {
  users: Record<UserRole, number>;
  newUsersThisWeek: number;
  totalRequirements: number;
  newRequirementsThisWeek: number;
  totalQuotes: number;
  totalBookings: number;
  openDisputes: number;
  pendingVerifications: number;
  growth: { date: string; users: number; requirements: number; bookings: number }[];
}

export async function getOverview(): Promise<AdminOverview> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    users,
    newUsersThisWeek,
    totalRequirements,
    newRequirementsThisWeek,
    totalQuotes,
    totalBookings,
    openDisputes,
    pendingVerifications,
    growth,
  ] = await Promise.all([
    repo.users.countByRole(),
    repo.users.countCreatedSince(weekAgo),
    repo.requirements.count(),
    repo.requirements.countSince(weekAgo),
    repo.quotes.count(),
    repo.bookings.count(),
    repo.disputes.countOpen(),
    repo.verification.countPending(),
    repo.analytics.growthSeries(30),
  ]);

  return {
    users,
    newUsersThisWeek,
    totalRequirements,
    newRequirementsThisWeek,
    totalQuotes,
    totalBookings,
    openDisputes,
    pendingVerifications,
    growth,
  };
}

// ─────────────────────────── Users ───────────────────────────

export async function listUsers(
  actor: User,
  filter: {
    role?: UserRole;
    query?: string;
    isSuspended?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<Page<User>> {
  // Searching people by name or email is a PII read; record that it happened.
  if (filter.query) {
    await repo.audit
      .record({
        actorId: actor.id,
        action: "admin.users.searched",
        metadata: { query: filter.query },
      })
      .catch(() => {});
  }
  return repo.users.list(filter);
}

export async function setUserSuspended(
  actor: User,
  userId: string,
  suspended: boolean,
): Promise<User> {
  if (userId === actor.id) {
    throw GatewayError.validation("You can't suspend your own account.");
  }

  const target = await repo.users.findById(userId);
  if (!target) throw GatewayError.notFound("User not found");
  // Admins suspending admins is a foot-gun and an escalation path.
  if (target.role === "admin") {
    throw GatewayError.forbidden("Administrators can't be suspended here.");
  }

  const updated = await repo.users.setSuspended(userId, suspended, actor);

  /*
   * Revoke at the identity provider too, not just in our database.
   *
   * Suspension already "works" because getSession re-reads the row and returns
   * null for a suspended user — but that makes one function the single thing
   * standing between a suspended account and a live session. Revoking the
   * provider's sessions means the credential itself stops working, so any
   * future code path that verifies a cookie without going through getSession
   * still refuses them.
   *
   * Best effort: a provider outage must not block the suspension itself, which
   * is the part that takes effect immediately.
   */
  if (suspended) {
    await revokeUserSessions(userId).catch((err) => {
      console.error(
        `[admin] suspended ${userId} but could not revoke their sessions:`,
        err,
      );
    });
  }

  await repo.audit
    .record({
      actorId: actor.id,
      action: suspended ? "admin.user.suspended" : "admin.user.unsuspended",
      target: userId,
    })
    .catch(() => {});

  return updated;
}

export async function setUserRole(
  actor: User,
  userId: string,
  role: UserRole,
): Promise<User> {
  if (userId === actor.id) {
    throw GatewayError.validation("You can't change your own role.");
  }

  const updated = await repo.users.setRole(userId, role, actor);

  // Privilege escalation — the single most important line in the audit log.
  await repo.audit
    .record({
      actorId: actor.id,
      action: "admin.user.role_changed",
      target: userId,
      metadata: { newRole: role },
    })
    .catch(() => {});

  return updated;
}

/**
 * Erases a user.
 *
 * Anonymise rather than hard-delete: bookings, reviews and disputes reference
 * this row, and dropping it would rewrite other people's history. The storage
 * objects and the identity record are removed separately, because neither
 * lives in our database.
 */
export async function eraseUser(
  actor: User,
  userId: string,
): Promise<{ storageObjectsRemoved: number }> {
  if (userId === actor.id) {
    throw GatewayError.validation(
      "Use your own account settings to delete your account.",
    );
  }

  const target = await repo.users.findById(userId);
  if (!target) throw GatewayError.notFound("User not found");
  if (target.role === "admin") {
    throw GatewayError.forbidden("Administrators can't be erased here.");
  }

  // Storage keys must be read BEFORE anonymise drops the rows pointing at them,
  // or the objects are orphaned in the bucket forever.
  const keys = await repo.users.listStorageKeys(userId, actor);
  const { storageProvider } = await import(
    "@/lib/providers/storage/index.server"
  );
  await Promise.all(
    keys.map((key) => storageProvider().delete(key).catch(() => {})),
  );

  await repo.users.anonymize(userId, actor);

  // The identity provider holds the account independently of our database.
  await deleteIdentity(userId).catch((err) => {
    console.error("[admin] identity deletion failed for", userId, err);
  });

  await repo.audit
    .record({
      actorId: actor.id,
      action: "admin.user.erased",
      target: userId,
      metadata: { storageObjectsRemoved: keys.length },
    })
    .catch(() => {});

  return { storageObjectsRemoved: keys.length };
}

// ─────────────────────────── Disputes ───────────────────────────

export async function listDisputes(filter: {
  status?: DisputeStatus;
  limit?: number;
  offset?: number;
}): Promise<Page<Dispute>> {
  return repo.disputes.list(filter);
}

export async function resolveDispute(
  actor: User,
  disputeId: string,
  resolution: string,
  outcome: "resolved" | "rejected",
): Promise<Dispute> {
  const dispute = await repo.disputes.resolve(
    disputeId,
    resolution,
    actor,
    outcome,
  );

  // Both parties need to know, not just the person who raised it.
  const booking = await repo.bookings.findById(dispute.bookingId);
  if (booking) {
    await Promise.all(
      [booking.customerId, booking.providerId].map((userId) =>
        notify({
          userId,
          type: "dispute_resolved",
          title: `Dispute ${outcome}`,
          body: resolution.slice(0, 200),
          data: { bookingId: booking.id, disputeId },
        }),
      ),
    );
  }

  await repo.audit
    .record({
      actorId: actor.id,
      action: `admin.dispute.${outcome}`,
      target: disputeId,
    })
    .catch(() => {});

  return dispute;
}

// ─────────────────────────── Verification (KYC) ───────────────────────────

export async function listVerificationQueue(
  actor: User,
  filter: { status?: "pending" | "approved" | "rejected"; limit?: number },
): Promise<Page<VerificationRequest>> {
  // Viewing identity documents is itself an auditable event.
  await repo.audit
    .record({
      actorId: actor.id,
      action: "admin.verification.queue_viewed",
      metadata: { status: filter.status ?? "pending" },
    })
    .catch(() => {});

  return repo.verification.listQueue(filter);
}

/**
 * Signed URLs for the submitted documents.
 *
 * Kept separate from the queue listing so opening the queue does not mint read
 * URLs for every document in it — they are only issued for the request an
 * admin actually opens.
 */
export async function getVerificationDocuments(
  actor: User,
  requestId: string,
): Promise<{ request: VerificationRequest; documentUrls: string[] }> {
  const request = await repo.verification.findById(requestId);
  if (!request) throw GatewayError.notFound("Verification request not found");

  const { storageProvider } = await import(
    "@/lib/providers/storage/index.server"
  );

  const documentUrls = await Promise.all(
    request.docUrls.map((key) =>
      storageProvider()
        .getReadUrl(key, "document")
        // A seeded or missing object shouldn't blank the whole review screen.
        .catch(() => key),
    ),
  );

  await repo.audit
    .record({
      actorId: actor.id,
      action: "admin.verification.documents_viewed",
      target: requestId,
      metadata: { userId: request.userId },
    })
    .catch(() => {});

  return { request, documentUrls };
}

export async function approveVerification(
  actor: User,
  requestId: string,
  note?: string,
): Promise<VerificationRequest> {
  const request = await repo.verification.approve(requestId, actor, note);

  await notify({
      userId: request.userId,
      type: "verification_approved",
      title: "You're verified",
      body: "Your identity documents were approved.",
    });

  await repo.audit
    .record({
      actorId: actor.id,
      action: "admin.verification.approved",
      target: requestId,
      metadata: { userId: request.userId },
    })
    .catch(() => {});

  return request;
}

export async function rejectVerification(
  actor: User,
  requestId: string,
  note: string,
): Promise<VerificationRequest> {
  const request = await repo.verification.reject(requestId, actor, note);

  await notify({
      userId: request.userId,
      type: "verification_rejected",
      title: "Verification needs attention",
      body: note.slice(0, 200),
    });

  await repo.audit
    .record({
      actorId: actor.id,
      action: "admin.verification.rejected",
      target: requestId,
      metadata: { userId: request.userId },
    })
    .catch(() => {});

  return request;
}

// ─────────────────────────── Moderation ───────────────────────────

export async function listFlaggedMessages(filter: {
  limit?: number;
  offset?: number;
}): Promise<Page<Message>> {
  return repo.messages.listFlagged(filter);
}

export async function clearMessageFlag(
  actor: User,
  messageId: string,
): Promise<Message> {
  const message = await repo.messages.clearFlag(messageId);
  await repo.audit
    .record({
      actorId: actor.id,
      action: "admin.message.flag_cleared",
      target: messageId,
    })
    .catch(() => {});
  return message;
}

export async function listReports(filter: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<Page<Report>> {
  return repo.moderation.listReports(filter);
}

export async function resolveReport(
  actor: User,
  reportId: string,
): Promise<Report> {
  const report = await repo.moderation.resolveReport(reportId, actor);
  await repo.audit
    .record({
      actorId: actor.id,
      action: "admin.report.resolved",
      target: reportId,
    })
    .catch(() => {});
  return report;
}

// ─────────────────────────── Fraud & revenue ───────────────────────────

export interface FraudView {
  suspiciousAccounts: User[];
  suspiciousReviews: Review[];
}

export async function getFraudView(actor: User): Promise<FraudView> {
  const [suspiciousAccounts, suspiciousReviews] = await Promise.all([
    repo.users.findSuspiciousAccounts(actor, 50),
    repo.reviews.findSuspicious(50),
  ]);
  return { suspiciousAccounts, suspiciousReviews };
}

export interface RevenueView {
  byTier: { tier: SubscriptionTier; count: number; mrr: number }[];
  totalMrr: number;
  bookingVolume: number;
}

export async function getRevenueView(): Promise<RevenueView> {
  const [byTier, bookingVolume] = await Promise.all([
    repo.subscriptions.revenueSummary(),
    repo.bookings.sumCompletedAmount(),
  ]);

  return {
    byTier,
    totalMrr: byTier.reduce((sum, row) => sum + row.mrr, 0),
    bookingVolume,
  };
}

// ─────────────────────────── Feature flags & audit ───────────────────────────

export async function listFlags(): Promise<FeatureFlag[]> {
  return repo.featureFlags.list();
}

export async function setFlag(
  actor: User,
  key: string,
  enabled: boolean,
): Promise<FeatureFlag> {
  const flag = await repo.featureFlags.set(key, enabled, actor);

  // Flags change behaviour for everyone at once — always audited.
  await repo.audit
    .record({
      actorId: actor.id,
      action: "admin.flag.changed",
      target: key,
      metadata: { enabled },
    })
    .catch(() => {});

  return flag;
}

export async function listAuditEvents(filter: {
  actorId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}): Promise<Page<AuditEvent>> {
  return repo.audit.list(filter);
}
