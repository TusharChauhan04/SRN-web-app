/**
 * Row → domain mappers.
 *
 * All the SQLite-shaped compromises are isolated here: comma-joined lists and
 * JSON-in-a-string columns become real arrays and objects before anything else
 * in the app sees them. A future Postgres implementation can drop the splitting
 * and keep the same output shape.
 */
import type {
  AuditEvent,
  BlockedDate,
  Booking,
  BookingStatus,
  Conversation,
  Dispute,
  DisputeStatus,
  FeatureFlag,
  Message,
  Notification,
  NotificationPrefs,
  PortfolioItem,
  Presence,
  PublicUser,
  Quote,
  QuoteStatus,
  Referral,
  Report,
  Requirement,
  RequirementStatus,
  Review,
  Subscription,
  SubscriptionTier,
  Upload,
  UploadContext,
  User,
  UserRole,
  VerificationRequest,
  VerificationStatus,
  WorkingHours,
} from "../types";

/** Comma-joined column → string[]. Empty/blank yields []. */
export function splitList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * string[] → comma-DELIMITED column, e.g. ["react","node"] → ",react,node,".
 *
 * The leading and trailing commas are load-bearing: they let a query match a
 * whole token with `contains: ",react,"`. Without them an unanchored LIKE
 * matched across token boundaries, so searching "java" returned providers who
 * had only listed "javascript". Empty array yields null, not "".
 */
export function joinList(
  value: string[] | null | undefined,
): string | null {
  if (!value || value.length === 0) return null;
  const items = value.map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return null;
  return `,${items.join(",")},`;
}

/**
 * Parses a JSON-in-a-string column. Returns null on malformed data rather than
 * throwing — a corrupt metadata blob should never take down a list endpoint.
 */
export function parseJson(
  value: string | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function stringifyJson(
  value: Record<string, unknown> | null | undefined,
): string | null {
  if (!value) return null;
  return JSON.stringify(value);
}

/*
 * Rows are typed against the GENERATED Prisma models, not `Record<string,
 * unknown>`.
 *
 * This matters: with a loose row type, renaming a column in schema.prisma
 * typechecks clean and the mapper silently returns `undefined` for that field —
 * a data-shaped bug that reaches the UI as a blank value rather than an error.
 * Typing the input means the build breaks at the mapper instead.
 *
 * `WithRelations` widens each model so an `include`d relation (which Prisma
 * types per-query) can still be read off the row. The MODEL's own columns stay
 * strictly typed, which is where drift actually happens.
 */
import type {
  AuditEvent as PrismaAuditEvent,
  BlockedDate as PrismaBlockedDate,
  Booking as PrismaBooking,
  Conversation as PrismaConversation,
  Dispute as PrismaDispute,
  FeatureFlag as PrismaFeatureFlag,
  Message as PrismaMessage,
  Notification as PrismaNotification,
  NotificationPref as PrismaNotificationPref,
  PhoneVerification as PrismaPhoneVerification,
  PortfolioItem as PrismaPortfolioItem,
  Presence as PrismaPresence,
  Quote as PrismaQuote,
  Referral as PrismaReferral,
  Report as PrismaReport,
  Requirement as PrismaRequirement,
  Review as PrismaReview,
  Subscription as PrismaSubscription,
  Upload as PrismaUpload,
  User as PrismaUser,
  VerificationRequest as PrismaVerificationRequest,
  WorkingHours as PrismaWorkingHours,
} from "@prisma/client";

/*
 * Relations are declared EXPLICITLY per mapper rather than through a catch-all
 * index signature.
 *
 * A first attempt used `T & Record<string, unknown>`, which looked right and
 * did nothing: the index signature makes every property access legal, so a
 * renamed column still typechecked. Only probing it with a deliberate rename
 * exposed that. Naming each relation is more typing and is the only version
 * that actually fails the build on drift.
 */
type UserSummaryRow = Pick<PrismaUser, "id" | "name" | "avatarUrl" | "role">;

type RequirementRow = PrismaRequirement & {
  creator?: UserSummaryRow | null;
  _count?: { quotes?: number };
};

type QuoteRow = PrismaQuote & {
  sender?: Pick<
    PrismaUser,
    "id" | "name" | "avatarUrl" | "rating" | "title"
  > | null;
  requirement?: Pick<PrismaRequirement, "id" | "title" | "maxBudget"> | null;
};

type BookingRow = PrismaBooking & {
  customer?: Pick<PrismaUser, "id" | "name" | "avatarUrl"> | null;
  provider?: Pick<PrismaUser, "id" | "name" | "avatarUrl"> | null;
  requirement?: Pick<PrismaRequirement, "id" | "title"> | null;
  review?: { id: string } | null;
};

type ReviewRow = PrismaReview & {
  author?: Pick<PrismaUser, "id" | "name" | "avatarUrl"> | null;
};

type DisputeRow = PrismaDispute & {
  raisedBy?: Pick<PrismaUser, "id" | "name" | "avatarUrl"> | null;
  booking?: Pick<
    PrismaBooking,
    "id" | "amount" | "customerId" | "providerId"
  > | null;
};

type VerificationRow = PrismaVerificationRequest & {
  user?: Pick<PrismaUser, "id" | "name" | "email" | "role" | "avatarUrl"> | null;
};

type AuditRow = PrismaAuditEvent & {
  actor?: Pick<PrismaUser, "id" | "name" | "email"> | null;
};

/** Only for the PII-safe projection, which is a `select` and not a full row. */
type Row = Record<string, unknown>;

export function toUser(row: PrismaUser): User {
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    role: row.role as UserRole,
    phone: (row.phone as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    avatarUrl: (row.avatarUrl as string | null) ?? null,
    isVerified: Boolean(row.isVerified),
    isPremium: Boolean(row.isPremium),
    isSuspended: Boolean(row.isSuspended),
    phoneVerified: Boolean(row.phoneVerified),
    title: (row.title as string | null) ?? null,
    skills: splitList(row.skills as string | null),
    portfolioLinks: splitList(row.portfolioLinks as string | null),
    hourlyRate: (row.hourlyRate as number | null) ?? null,
    rating: (row.rating as number | null) ?? 0,
    reviewsCount: (row.reviewsCount as number) ?? 0,
    completedGigs: (row.completedGigs as number) ?? 0,
    onTimeRate: (row.onTimeRate as number | null) ?? null,
    rehireCount: (row.rehireCount as number) ?? 0,
    aiTrustScore: (row.aiTrustScore as number | null) ?? null,
    serviceRadiusKm: (row.serviceRadiusKm as number | null) ?? null,
    isAvailable: Boolean(row.isAvailable),
    companyName: (row.companyName as string | null) ?? null,
    industry: (row.industry as string | null) ?? null,
    postedRequirementsCount: (row.postedRequirementsCount as number) ?? 0,
    privileges: splitList(row.privileges as string | null),
    fcmToken: (row.fcmToken as string | null) ?? null,
    deletionRequestedAt: (row.deletionRequestedAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

/** Columns safe to expose on public discovery surfaces. Pair with toPublicUser. */
export const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  role: true,
  title: true,
  bio: true,
  location: true,
  avatarUrl: true,
  skills: true,
  portfolioLinks: true,
  hourlyRate: true,
  rating: true,
  reviewsCount: true,
  completedGigs: true,
  onTimeRate: true,
  isVerified: true,
  isPremium: true,
  isAvailable: true,
  serviceRadiusKm: true,
  companyName: true,
  industry: true,
  createdAt: true,
} as const;

export function toPublicUser(row: Row): PublicUser {
  return {
    id: row.id as string,
    name: row.name as string,
    role: row.role as UserRole,
    title: (row.title as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    avatarUrl: (row.avatarUrl as string | null) ?? null,
    skills: splitList(row.skills as string | null),
    portfolioLinks: splitList(row.portfolioLinks as string | null),
    hourlyRate: (row.hourlyRate as number | null) ?? null,
    rating: (row.rating as number | null) ?? 0,
    reviewsCount: (row.reviewsCount as number) ?? 0,
    completedGigs: (row.completedGigs as number) ?? 0,
    onTimeRate: (row.onTimeRate as number | null) ?? null,
    isVerified: Boolean(row.isVerified),
    isPremium: Boolean(row.isPremium),
    isAvailable: Boolean(row.isAvailable),
    serviceRadiusKm: (row.serviceRadiusKm as number | null) ?? null,
    companyName: (row.companyName as string | null) ?? null,
    industry: (row.industry as string | null) ?? null,
    createdAt: row.createdAt as Date,
  };
}

/** The trimmed user shape embedded in lists (avoids leaking PII into feeds). */
export function toUserSummary(row: Row | null | undefined) {
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    avatarUrl: (row.avatarUrl as string | null) ?? null,
    role: row.role as UserRole,
  };
}

export function toRequirement(row: RequirementRow): Requirement {
  const creator = row.creator as Row | undefined;
  const count = row._count as { quotes?: number } | undefined;
  return {
    id: row.id as string,
    creatorId: row.creatorId as string,
    title: row.title as string,
    category: row.category as string,
    description: row.description as string,
    skillsNeeded: splitList(row.skillsNeeded as string | null),
    minBudget: row.minBudget as number,
    maxBudget: row.maxBudget as number,
    location: (row.location as string | null) ?? null,
    status: row.status as RequirementStatus,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
    creator: toUserSummary(creator),
    quoteCount: count?.quotes,
  };
}

export function toQuote(row: QuoteRow): Quote {
  const sender = row.sender as Row | undefined;
  const requirement = row.requirement as Row | undefined;
  return {
    id: row.id as string,
    requirementId: row.requirementId as string,
    senderId: row.senderId as string,
    receiverId: row.receiverId as string,
    amount: row.amount as number,
    durationDays: row.durationDays as number,
    message: (row.message as string | null) ?? null,
    status: row.status as QuoteStatus,
    counterOfQuoteId: (row.counterOfQuoteId as string | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
    sender: sender
      ? {
          id: sender.id as string,
          name: sender.name as string,
          avatarUrl: (sender.avatarUrl as string | null) ?? null,
          rating: (sender.rating as number | null) ?? 0,
          title: (sender.title as string | null) ?? null,
        }
      : null,
    requirement: requirement
      ? {
          id: requirement.id as string,
          title: requirement.title as string,
          maxBudget: requirement.maxBudget as number,
        }
      : null,
  };
}

export function toBooking(row: BookingRow): Booking {
  const customer = row.customer as Row | undefined;
  const provider = row.provider as Row | undefined;
  const requirement = row.requirement as Row | undefined;
  return {
    id: row.id as string,
    quoteId: (row.quoteId as string | null) ?? null,
    requirementId: (row.requirementId as string | null) ?? null,
    customerId: row.customerId as string,
    providerId: row.providerId as string,
    amount: row.amount as number,
    status: row.status as BookingStatus,
    scheduledFor: (row.scheduledFor as Date | null) ?? null,
    completedAt: (row.completedAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
    customer: customer
      ? {
          id: customer.id as string,
          name: customer.name as string,
          avatarUrl: (customer.avatarUrl as string | null) ?? null,
        }
      : null,
    provider: provider
      ? {
          id: provider.id as string,
          name: provider.name as string,
          avatarUrl: (provider.avatarUrl as string | null) ?? null,
        }
      : null,
    requirement: requirement
      ? { id: requirement.id as string, title: requirement.title as string }
      : null,
    hasReview: row.review !== undefined ? row.review !== null : undefined,
  };
}

export function toReview(row: ReviewRow): Review {
  const author = row.author as Row | undefined;
  return {
    id: row.id as string,
    bookingId: row.bookingId as string,
    authorId: row.authorId as string,
    subjectId: row.subjectId as string,
    rating: row.rating as number,
    comment: (row.comment as string | null) ?? null,
    isFlagged: Boolean(row.isFlagged),
    createdAt: row.createdAt as Date,
    author: author
      ? {
          id: author.id as string,
          name: author.name as string,
          avatarUrl: (author.avatarUrl as string | null) ?? null,
        }
      : null,
  };
}

export function toConversation(row: PrismaConversation): Conversation {
  return {
    id: row.id as string,
    participantIds: splitList(row.participantIds as string),
    lastMessageAt: row.lastMessageAt as Date,
    lastMessageText: (row.lastMessageText as string | null) ?? null,
    createdAt: row.createdAt as Date,
  };
}

export function toMessage(row: PrismaMessage): Message {
  return {
    id: row.id as string,
    conversationId: row.conversationId as string,
    senderId: row.senderId as string,
    receiverId: row.receiverId as string,
    text: row.text as string,
    attachmentUrl: (row.attachmentUrl as string | null) ?? null,
    attachmentName: (row.attachmentName as string | null) ?? null,
    attachmentSize: (row.attachmentSize as string | null) ?? null,
    quoteId: (row.quoteId as string | null) ?? null,
    read: Boolean(row.read),
    isFlagged: Boolean(row.isFlagged),
    isDeleted: Boolean(row.isDeleted),
    createdAt: row.createdAt as Date,
  };
}

export function toDispute(row: DisputeRow): Dispute {
  const raisedBy = row.raisedBy as Row | undefined;
  const booking = row.booking as Row | undefined;
  return {
    id: row.id as string,
    bookingId: row.bookingId as string,
    raisedById: row.raisedById as string,
    reason: row.reason as string,
    details: row.details as string,
    evidenceUrls: splitList(row.evidenceUrls as string | null),
    status: row.status as DisputeStatus,
    resolution: (row.resolution as string | null) ?? null,
    resolvedById: (row.resolvedById as string | null) ?? null,
    resolvedAt: (row.resolvedAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
    raisedBy: raisedBy
      ? {
          id: raisedBy.id as string,
          name: raisedBy.name as string,
          avatarUrl: (raisedBy.avatarUrl as string | null) ?? null,
        }
      : null,
    booking: booking
      ? {
          id: booking.id as string,
          amount: booking.amount as number,
          customerId: booking.customerId as string,
          providerId: booking.providerId as string,
        }
      : null,
  };
}

export function toVerificationRequest(row: VerificationRow): VerificationRequest {
  const user = row.user as Row | undefined;
  return {
    id: row.id as string,
    userId: row.userId as string,
    docType: row.docType as string,
    docUrls: splitList(row.docUrls as string),
    status: row.status as VerificationStatus,
    reviewNote: (row.reviewNote as string | null) ?? null,
    reviewedById: (row.reviewedById as string | null) ?? null,
    reviewedAt: (row.reviewedAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
    user: user
      ? {
          id: user.id as string,
          name: user.name as string,
          email: user.email as string,
          role: user.role as UserRole,
          avatarUrl: (user.avatarUrl as string | null) ?? null,
        }
      : null,
  };
}

export function toPortfolioItem(row: PrismaPortfolioItem): PortfolioItem {
  return {
    id: row.id as string,
    userId: row.userId as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    imageUrl: (row.imageUrl as string | null) ?? null,
    projectUrl: (row.projectUrl as string | null) ?? null,
    isFeatured: Boolean(row.isFeatured),
    likeCount: (row.likeCount as number) ?? 0,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

export function toWorkingHours(row: PrismaWorkingHours): WorkingHours {
  return {
    id: row.id as string,
    userId: row.userId as string,
    dayOfWeek: row.dayOfWeek as number,
    startTime: row.startTime as string,
    endTime: row.endTime as string,
    isEnabled: Boolean(row.isEnabled),
  };
}

export function toBlockedDate(row: PrismaBlockedDate): BlockedDate {
  return {
    id: row.id as string,
    userId: row.userId as string,
    date: row.date as Date,
    reason: (row.reason as string | null) ?? null,
  };
}

export function toSubscription(row: PrismaSubscription): Subscription {
  return {
    id: row.id as string,
    userId: row.userId as string,
    tier: row.tier as SubscriptionTier,
    status: row.status as string,
    razorpayOrderId: (row.razorpayOrderId as string | null) ?? null,
    razorpayPaymentId: (row.razorpayPaymentId as string | null) ?? null,
    currentPeriodEnd: (row.currentPeriodEnd as Date | null) ?? null,
    cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

export function toNotification(row: PrismaNotification): Notification {
  return {
    id: row.id as string,
    userId: row.userId as string,
    type: row.type as string,
    title: row.title as string,
    body: row.body as string,
    data: parseJson(row.data as string | null),
    read: Boolean(row.read),
    createdAt: row.createdAt as Date,
  };
}

export function toNotificationPrefs(row: PrismaNotificationPref): NotificationPrefs {
  return {
    userId: row.userId as string,
    push: Boolean(row.push),
    email: Boolean(row.email),
    quotes: Boolean(row.quotes),
    bookings: Boolean(row.bookings),
    messages: Boolean(row.messages),
    marketing: Boolean(row.marketing),
  };
}

export function toReferral(row: PrismaReferral): Referral {
  return {
    userId: row.userId as string,
    code: row.code as string,
    referredById: (row.referredById as string | null) ?? null,
    signupCount: (row.signupCount as number) ?? 0,
    rewardPoints: (row.rewardPoints as number) ?? 0,
    createdAt: row.createdAt as Date,
  };
}

export function toPresence(row: PrismaPresence): Presence {
  return {
    userId: row.userId as string,
    isOnline: Boolean(row.isOnline),
    lastHeartbeat: row.lastHeartbeat as Date,
  };
}

export function toUpload(row: PrismaUpload): Upload {
  return {
    id: row.id as string,
    userId: row.userId as string,
    fileName: row.fileName as string,
    mimeType: row.mimeType as string,
    sizeBytes: row.sizeBytes as number,
    context: row.context as UploadContext,
    entityId: (row.entityId as string | null) ?? null,
    storageKey: row.storageKey as string,
    publicUrl: (row.publicUrl as string | null) ?? null,
    confirmed: Boolean(row.confirmed),
    createdAt: row.createdAt as Date,
  };
}

export function toAuditEvent(row: AuditRow): AuditEvent {
  const actor = row.actor as Row | undefined;
  return {
    id: row.id as string,
    actorId: (row.actorId as string | null) ?? null,
    action: row.action as string,
    target: (row.target as string | null) ?? null,
    metadata: parseJson(row.metadata as string | null),
    ip: (row.ip as string | null) ?? null,
    createdAt: row.createdAt as Date,
    actor: actor
      ? {
          id: actor.id as string,
          name: actor.name as string,
          email: actor.email as string,
        }
      : null,
  };
}

export function toFeatureFlag(row: PrismaFeatureFlag): FeatureFlag {
  return {
    key: row.key as string,
    enabled: Boolean(row.enabled),
    description: (row.description as string | null) ?? null,
    updatedAt: row.updatedAt as Date,
  };
}

export function toReport(row: PrismaReport): Report {
  return {
    id: row.id as string,
    reporterId: row.reporterId as string,
    reportedId: row.reportedId as string,
    targetType: row.targetType as string,
    targetId: (row.targetId as string | null) ?? null,
    reason: row.reason as string,
    details: (row.details as string | null) ?? null,
    status: row.status as string,
    resolvedAt: (row.resolvedAt as Date | null) ?? null,
    createdAt: row.createdAt as Date,
  };
}

export function toPhoneChallenge(row: PrismaPhoneVerification) {
  return {
    userId: row.userId as string,
    phone: row.phone as string,
    codeHash: row.codeHash as string,
    attempts: (row.attempts as number) ?? 0,
    expiresAt: row.expiresAt as Date,
  };
}

/**
 * Canonical participant key for a 1:1 conversation, e.g. ",alice,bob,".
 *
 * Sorting makes the pair order-independent so (a,b) and (b,a) resolve to the
 * same thread. The surrounding commas let a lookup anchor on ",uid," instead
 * of an unanchored substring match.
 */
export function conversationKey(a: string, b: string): string {
  return `,${[a, b].sort().join(",")},`;
}
