/**
 * Repository interfaces — the swap boundary for the database.
 *
 * Every method here corresponds to an operation the app actually performs,
 * derived from the ~100 endpoints in the mobile backend's 25 route modules
 * (artifacts/api-server/src/routes/*). This is deliberately NOT generic CRUD:
 * the filters are the filters real screens use.
 *
 * When the real database is chosen, write a new set of classes implementing
 * these interfaces and change the wiring in ./index.ts. Nothing else moves.
 * See DATABASE.md.
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
  Page,
  PageParams,
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
} from "./types";

// ─────────────────────────── Users ───────────────────────────

export interface CreateUserInput {
  id: string; // Firebase uid — caller supplies, never generated here
  email: string;
  name: string;
  role: UserRole;
  title?: string;
  location?: string;
  bio?: string;
  skills?: string[];
  phone?: string;
  companyName?: string;
  industry?: string;
}

export type UpdateUserInput = Partial<
  Omit<CreateUserInput, "id" | "role"> & {
    avatarUrl: string;
    portfolioLinks: string[];
    hourlyRate: number;
    serviceRadiusKm: number;
    isAvailable: boolean;
    fcmToken: string;
    phoneVerified: boolean;
  }
>;

export interface ListUsersFilter extends PageParams {
  role?: UserRole;
  /** Free-text across name/email/title. */
  query?: string;
  isSuspended?: boolean;
  isVerified?: boolean;
}

export interface SearchProvidersFilter extends PageParams {
  query?: string;
  skills?: string[];
  minRating?: number;
  maxHourlyRate?: number;
  location?: string;
  role?: "digital" | "local";
}

export interface UserRepository {
  create(input: CreateUserInput): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  update(id: string, input: UpdateUserInput): Promise<User>;
  list(filter?: ListUsersFilter): Promise<Page<User>>;
  /** Public discovery — returns a PII-free projection, never full User rows. */
  searchProviders(filter: SearchProvidersFilter): Promise<Page<PublicUser>>;

  // Admin operations — /admin/users/:id/*
  setSuspended(id: string, suspended: boolean): Promise<User>;
  setRole(id: string, role: UserRole): Promise<User>;
  delete(id: string): Promise<void>;

  // GDPR — /gdpr/account
  markForDeletion(id: string, at: Date): Promise<User>;
  cancelDeletion(id: string): Promise<User>;
  /**
   * Strips PII in place across the user row AND every related row that carries
   * identity (KYC docs, message text, dispute evidence, uploads), keeping the
   * User row for referential integrity.
   *
   * NOT sufficient on its own: call `listStorageKeys` first and delete those
   * objects from storage, and delete the Firebase Auth user separately. Neither
   * lives in this database.
   */
  anonymize(id: string): Promise<void>;
  /** Storage keys to delete from object storage before `anonymize`. */
  listStorageKeys(id: string): Promise<string[]>;
  /** Every row belonging to this user, for the GDPR export bundle. */
  exportAll(id: string): Promise<Record<string, unknown>>;

  // Aggregate counters used by dashboards
  countByRole(): Promise<Record<UserRole, number>>;
  countCreatedSince(since: Date): Promise<number>;
  /** Accounts sharing a signal (same IP/device) — /admin/fraud/accounts. */
  findSuspiciousAccounts(limit?: number): Promise<User[]>;
}

// ─────────────────────────── Requirements ───────────────────────────

export interface CreateRequirementInput {
  creatorId: string;
  title: string;
  category: string;
  description: string;
  skillsNeeded?: string[];
  minBudget: number;
  maxBudget: number;
  location?: string;
}

export interface ListRequirementsFilter extends PageParams {
  creatorId?: string;
  status?: RequirementStatus;
  category?: string;
  query?: string;
  minBudget?: number;
  maxBudget?: number;
  skills?: string[];
}

export interface RequirementRepository {
  create(input: CreateRequirementInput): Promise<Requirement>;
  findById(id: string): Promise<Requirement | null>;
  list(filter?: ListRequirementsFilter): Promise<Page<Requirement>>;
  /** Open requirements matched to a provider's skills — /requirements/feed. */
  feedForProvider(
    providerId: string,
    params?: PageParams,
  ): Promise<Page<Requirement>>;
  updateStatus(id: string, status: RequirementStatus): Promise<Requirement>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
  countSince(since: Date): Promise<number>;
}

// ─────────────────────────── Quotes ───────────────────────────

export interface CreateQuoteInput {
  requirementId: string;
  senderId: string;
  receiverId: string;
  amount: number;
  durationDays: number;
  message?: string;
  counterOfQuoteId?: string;
}

export interface ListQuotesFilter extends PageParams {
  requirementId?: string;
  senderId?: string;
  receiverId?: string;
  status?: QuoteStatus;
}

export interface QuoteRepository {
  create(input: CreateQuoteInput): Promise<Quote>;
  findById(id: string): Promise<Quote | null>;
  list(filter?: ListQuotesFilter): Promise<Page<Quote>>;
  updateStatus(id: string, status: QuoteStatus): Promise<Quote>;
  /** Marks one quote shortlisted — /requirements/:id/shortlist/:quoteId. */
  shortlist(requirementId: string, quoteId: string): Promise<Quote>;
  delete(id: string): Promise<void>;
  /**
   * True when this provider already has a live bid on this requirement.
   *
   * Advisory only — this is check-then-act, so two concurrent submissions can
   * both pass. A database unique constraint is deliberately NOT used, because
   * it would also block a legitimate re-bid after a withdrawal or rejection.
   * Callers should treat a duplicate as a UX problem, not a data-integrity one.
   */
  existsForSenderOnRequirement(
    senderId: string,
    requirementId: string,
  ): Promise<boolean>;
  count(): Promise<number>;
}

// ─────────────────────────── Bookings ───────────────────────────

export interface CreateBookingInput {
  quoteId?: string;
  requirementId?: string;
  customerId: string;
  providerId: string;
  amount: number;
  scheduledFor?: Date;
}

export interface ListBookingsFilter extends PageParams {
  customerId?: string;
  providerId?: string;
  status?: BookingStatus;
}

export interface BookingRepository {
  create(input: CreateBookingInput): Promise<Booking>;
  findById(id: string): Promise<Booking | null>;
  list(filter?: ListBookingsFilter): Promise<Page<Booking>>;
  updateStatus(id: string, status: BookingStatus): Promise<Booking>;
  /** Bookings occupying a provider's slots on a date — availability checks. */
  findByProviderOnDate(providerId: string, date: Date): Promise<Booking[]>;
  count(): Promise<number>;
  /** Sum of completed booking amounts, for earnings + revenue views. */
  sumCompletedAmount(providerId?: string): Promise<number>;
}

// ─────────────────────────── Reviews ───────────────────────────

export interface CreateReviewInput {
  bookingId: string;
  authorId: string;
  subjectId: string;
  rating: number;
  comment?: string;
}

export interface ListReviewsFilter extends PageParams {
  subjectId?: string;
  authorId?: string;
  isFlagged?: boolean;
}

export interface ReviewRepository {
  create(input: CreateReviewInput): Promise<Review>;
  findById(id: string): Promise<Review | null>;
  findByBookingId(bookingId: string): Promise<Review | null>;
  list(filter?: ListReviewsFilter): Promise<Page<Review>>;
  delete(id: string): Promise<void>;
  /** Recomputes the subject's cached rating/reviewsCount after a write. */
  recomputeSubjectRating(subjectId: string): Promise<void>;
  /** Reviews matching fraud heuristics — /admin/fraud/reviews. */
  findSuspicious(limit?: number): Promise<Review[]>;
}

// ─────────────────────────── Messaging ───────────────────────────

export interface SendMessageInput {
  senderId: string;
  receiverId: string;
  text: string;
  conversationId?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: string;
  quoteId?: string;
}

export interface MessageRepository {
  /** Finds or creates the 1:1 thread, then appends. Returns both. */
  send(input: SendMessageInput): Promise<{
    message: Message;
    conversation: Conversation;
  }>;
  listConversations(
    userId: string,
    params?: PageParams,
  ): Promise<Page<Conversation>>;
  findConversationById(id: string): Promise<Conversation | null>;
  /** Resolves the 1:1 thread between two users without creating one. */
  findConversationBetween(
    userIdA: string,
    userIdB: string,
  ): Promise<Conversation | null>;
  listMessages(
    conversationId: string,
    params?: PageParams,
  ): Promise<Page<Message>>;
  markConversationRead(conversationId: string, readerId: string): Promise<void>;
  deleteMessage(conversationId: string, messageId: string): Promise<void>;

  // Moderation — /admin/flagged-messages, /admin/messages/:id/clear
  listFlagged(params?: PageParams): Promise<Page<Message>>;
  clearFlag(messageId: string): Promise<Message>;
  countUnread(userId: string): Promise<number>;
}

// ─────────────────────────── Disputes ───────────────────────────

export interface CreateDisputeInput {
  bookingId: string;
  raisedById: string;
  reason: string;
  details: string;
  evidenceUrls?: string[];
}

export interface ListDisputesFilter extends PageParams {
  status?: DisputeStatus;
  raisedById?: string;
  bookingId?: string;
}

export interface DisputeRepository {
  create(input: CreateDisputeInput): Promise<Dispute>;
  findById(id: string): Promise<Dispute | null>;
  list(filter?: ListDisputesFilter): Promise<Page<Dispute>>;
  addEvidence(id: string, urls: string[]): Promise<Dispute>;
  resolve(
    id: string,
    resolution: string,
    resolvedById: string,
    status: Extract<DisputeStatus, "resolved" | "rejected">,
  ): Promise<Dispute>;
  countOpen(): Promise<number>;
}

// ─────────────────────────── Verification (KYC) ───────────────────────────

export interface CreateVerificationInput {
  userId: string;
  docType: string;
  docUrls: string[];
}

export interface VerificationRepository {
  create(input: CreateVerificationInput): Promise<VerificationRequest>;
  findById(id: string): Promise<VerificationRequest | null>;
  findLatestForUser(userId: string): Promise<VerificationRequest | null>;
  listQueue(
    filter?: PageParams & { status?: VerificationStatus },
  ): Promise<Page<VerificationRequest>>;
  /** Approving also flips the user's isVerified flag. */
  approve(
    id: string,
    reviewedById: string,
    note?: string,
  ): Promise<VerificationRequest>;
  reject(
    id: string,
    reviewedById: string,
    note: string,
  ): Promise<VerificationRequest>;
  countPending(): Promise<number>;
}

// ─────────────────────────── Portfolio ───────────────────────────

export interface CreatePortfolioInput {
  userId: string;
  title: string;
  description?: string;
  imageUrl?: string;
  projectUrl?: string;
}

export interface PortfolioRepository {
  create(input: CreatePortfolioInput): Promise<PortfolioItem>;
  findById(id: string): Promise<PortfolioItem | null>;
  listByUser(userId: string, params?: PageParams): Promise<Page<PortfolioItem>>;
  update(
    id: string,
    input: Partial<Omit<CreatePortfolioInput, "userId">>,
  ): Promise<PortfolioItem>;
  setFeatured(id: string, featured: boolean): Promise<PortfolioItem>;
  incrementLikes(id: string): Promise<PortfolioItem>;
  delete(id: string): Promise<void>;
}

// ─────────────────────────── Availability ───────────────────────────

export interface AvailabilityRepository {
  getWorkingHours(userId: string): Promise<WorkingHours[]>;
  setWorkingHours(
    userId: string,
    hours: Omit<WorkingHours, "id" | "userId">[],
  ): Promise<WorkingHours[]>;
  listBlockedDates(userId: string): Promise<BlockedDate[]>;
  blockDate(userId: string, date: Date, reason?: string): Promise<BlockedDate>;
  unblockDate(userId: string, date: Date): Promise<void>;
  /** Free slots for a provider on a date, minus blocks and existing bookings. */
  getAvailableSlots(
    providerId: string,
    date: Date,
  ): Promise<{ start: string; end: string }[]>;
}

// ─────────────────────────── Subscriptions ───────────────────────────

export interface SubscriptionRepository {
  findByUserId(userId: string): Promise<Subscription | null>;
  /** Records the pending Razorpay order before checkout opens. */
  createOrder(
    userId: string,
    tier: SubscriptionTier,
    razorpayOrderId: string,
  ): Promise<Subscription>;
  /** Called only from the verified webhook — never from the browser. */
  activateFromPayment(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    periodEnd: Date,
  ): Promise<Subscription>;
  cancelAtPeriodEnd(userId: string): Promise<Subscription>;
  /** Revenue rollup for /admin/stats/revenue. */
  revenueSummary(): Promise<{
    tier: SubscriptionTier;
    count: number;
    mrr: number;
  }[]>;
}

// ─────────────────────────── Notifications ───────────────────────────

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface NotificationRepository {
  create(input: CreateNotificationInput): Promise<Notification>;
  list(
    userId: string,
    filter?: PageParams & { unreadOnly?: boolean },
  ): Promise<Page<Notification>>;
  markRead(id: string, userId: string): Promise<Notification>;
  markAllRead(userId: string): Promise<number>;
  countUnread(userId: string): Promise<number>;

  getPrefs(userId: string): Promise<NotificationPrefs>;
  setPrefs(
    userId: string,
    prefs: Partial<Omit<NotificationPrefs, "userId">>,
  ): Promise<NotificationPrefs>;
}

// ─────────────────────────── Referrals ───────────────────────────

export interface ReferralRepository {
  /** Idempotent: returns the existing code or mints one. */
  getOrCreateCode(userId: string): Promise<Referral>;
  findByCode(code: string): Promise<Referral | null>;
  /** Credits the owner of `code` for a new signup. */
  applyCode(code: string, newUserId: string): Promise<Referral>;
  stats(userId: string): Promise<{ signupCount: number; rewardPoints: number }>;
  leaderboard(limit?: number): Promise<
    (Referral & { name: string; avatarUrl?: string | null })[]
  >;
}

// ─────────────────────────── Presence ───────────────────────────

export interface PresenceRepository {
  heartbeat(userId: string): Promise<Presence>;
  setOffline(userId: string): Promise<void>;
  get(userId: string): Promise<Presence | null>;
  getMany(userIds: string[]): Promise<Presence[]>;
}

// ─────────────────────────── Analytics ───────────────────────────

export interface ProviderAnalytics {
  profileViews: number;
  profileViewsSeries: { date: string; count: number }[];
  quotesSent: number;
  quotesAccepted: number;
  acceptanceRate: number;
  completedBookings: number;
  totalEarnings: number;
  averageRating: number;
}

export interface AnalyticsRepository {
  recordProfileView(subjectId: string, viewerId?: string): Promise<void>;
  providerAnalytics(
    providerId: string,
    days?: number,
  ): Promise<ProviderAnalytics>;
  /** New users/requirements/bookings per day — /admin/stats/growth. */
  growthSeries(days: number): Promise<
    { date: string; users: number; requirements: number; bookings: number }[]
  >;
}

// ─────────────────────────── Uploads ───────────────────────────

export interface CreateUploadInput {
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  context: UploadContext;
  entityId?: string;
  storageKey: string;
}

export interface UploadRepository {
  create(input: CreateUploadInput): Promise<Upload>;
  findById(id: string): Promise<Upload | null>;
  confirm(id: string, publicUrl: string): Promise<Upload>;
  delete(id: string): Promise<void>;
  listByUser(userId: string, context?: UploadContext): Promise<Upload[]>;
}

// ─────────────────────────── Moderation ───────────────────────────

export interface ModerationRepository {
  blockUser(blockerId: string, blockedId: string): Promise<void>;
  unblockUser(blockerId: string, blockedId: string): Promise<void>;
  listBlocked(blockerId: string): Promise<string[]>;
  isBlocked(blockerId: string, blockedId: string): Promise<boolean>;

  createReport(input: {
    reporterId: string;
    reportedId: string;
    targetType: string;
    targetId?: string;
    reason: string;
    details?: string;
  }): Promise<Report>;
  listReports(
    filter?: PageParams & { status?: string },
  ): Promise<Page<Report>>;
  resolveReport(id: string): Promise<Report>;
}

// ─────────────────────────── Platform ───────────────────────────

export interface AuditRepository {
  record(input: {
    actorId?: string;
    action: string;
    target?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
  }): Promise<AuditEvent>;
  list(
    filter?: PageParams & { actorId?: string; action?: string },
  ): Promise<Page<AuditEvent>>;
}

export interface FeatureFlagRepository {
  list(): Promise<FeatureFlag[]>;
  get(key: string): Promise<FeatureFlag | null>;
  set(key: string, enabled: boolean, description?: string): Promise<FeatureFlag>;
}

export interface RateLimitRepository {
  /**
   * Atomically increments the counter for `key` and reports whether the caller
   * is over `limit` within `windowMs`.
   */
  hit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>;
}

// ─────────────────────────── Health ───────────────────────────

export interface HealthRepository {
  /** Cheapest possible round-trip, for /api/healthz. */
  ping(): Promise<boolean>;
}

// ─────────────────────────── Registry ───────────────────────────

/**
 * The full set of repositories. Feature code imports the instance of this from
 * ./index, never a concrete class.
 */
export interface Repositories {
  users: UserRepository;
  requirements: RequirementRepository;
  quotes: QuoteRepository;
  bookings: BookingRepository;
  reviews: ReviewRepository;
  messages: MessageRepository;
  disputes: DisputeRepository;
  verification: VerificationRepository;
  portfolio: PortfolioRepository;
  availability: AvailabilityRepository;
  subscriptions: SubscriptionRepository;
  notifications: NotificationRepository;
  referrals: ReferralRepository;
  presence: PresenceRepository;
  analytics: AnalyticsRepository;
  uploads: UploadRepository;
  moderation: ModerationRepository;
  audit: AuditRepository;
  featureFlags: FeatureFlagRepository;
  rateLimit: RateLimitRepository;
  health: HealthRepository;
}
