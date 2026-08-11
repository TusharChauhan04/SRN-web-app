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
import type { Actor } from "./authorize";
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
  SubscriptionOrder,
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
  //
  // These take an explicit `actor` and assert on it. That is defence in depth,
  // NOT a replacement for gating the route with requireAdmin: it exists so that
  // forgetting to gate is a compile error rather than a silent privilege
  // escalation or PII dump. Pass SYSTEM_ACTOR for non-request callers.
  setSuspended(id: string, suspended: boolean, actor: Actor): Promise<User>;
  setRole(id: string, role: UserRole, actor: Actor): Promise<User>;
  delete(id: string, actor: Actor): Promise<void>;

  // GDPR — /gdpr/account. Self-or-admin: a user may erase or export their own
  // data, an admin may act on their behalf, nobody may touch a stranger's.
  markForDeletion(id: string, at: Date, actor: Actor): Promise<User>;
  cancelDeletion(id: string, actor: Actor): Promise<User>;
  /**
   * Strips PII in place across the user row AND every related row that carries
   * identity (KYC docs, message text, dispute evidence, uploads), keeping the
   * User row for referential integrity.
   *
   * NOT sufficient on its own: call `listStorageKeys` first and delete those
   * objects from storage, and delete the Firebase Auth user separately. Neither
   * lives in this database.
   */
  anonymize(id: string, actor: Actor): Promise<void>;
  /** Storage keys to delete from object storage before `anonymize`. */
  listStorageKeys(id: string, actor: Actor): Promise<string[]>;
  /** Every row belonging to this user, for the GDPR export bundle. */
  exportAll(id: string, actor: Actor): Promise<Record<string, unknown>>;

  // Aggregate counters used by dashboards
  countByRole(): Promise<Record<UserRole, number>>;
  countCreatedSince(since: Date): Promise<number>;
  /** Accounts sharing a signal (same IP/device) — /admin/fraud/accounts. */
  findSuspiciousAccounts(actor: Actor, limit?: number): Promise<User[]>;
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
  /**
   * Turns an accepted quote into a booking, atomically.
   *
   * All four writes — claim the requirement, accept the quote, create the
   * booking, reject the losing bids — happen in one transaction, and the
   * requirement claim is a CONDITIONAL update that doubles as the concurrency
   * gate. Without it, accepting two different bids on the same requirement in
   * the same instant produced two bookings and two committed providers; and a
   * failure between the writes left an orphan booking that made the quote
   * permanently unacceptable, because `Booking.quoteId` is unique.
   *
   * Throws `RepositoryConflictError` when the requirement is already claimed.
   */
  createFromAcceptedQuote(input: {
    quoteId: string;
    requirementId: string;
    customerId: string;
    providerId: string;
    amount: number;
  }): Promise<Booking>;
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
  /**
   * The MOST RECENT `limit` messages, returned oldest-first for rendering.
   *
   * Newest-first at the database and reversed here, deliberately: taking the
   * oldest N meant a conversation past the limit never showed a new message
   * again, and the 5s poll would overwrite an optimistically-sent message with
   * the stale page — the sender watched their own message disappear.
   */
  listMessages(
    conversationId: string,
    params?: PageParams,
  ): Promise<Page<Message>>;
  /** Single message by id. Used by delete, which must not scan a page. */
  findMessageById(
    conversationId: string,
    messageId: string,
  ): Promise<Message | null>;
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
  /** Scoped to the raiser (or an admin) — evidence is not open to anyone. */
  addEvidence(id: string, urls: string[], actor: Actor): Promise<Dispute>;
  /** Admin-only. Asserts on `actor` as well as recording it. */
  resolve(
    id: string,
    resolution: string,
    actor: Actor,
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
  /**
   * Takes an `actor` because this is the call that resolves the STORAGE KEYS
   * for someone's identity documents. Every other privileged method on this
   * repository asserts one; this one is how those documents are reached, so it
   * gets the same second line of defence as approve/reject.
   */
  findById(id: string, actor: Actor): Promise<VerificationRequest | null>;
  findLatestForUser(userId: string): Promise<VerificationRequest | null>;
  listQueue(
    filter?: PageParams & { status?: VerificationStatus },
  ): Promise<Page<VerificationRequest>>;
  /**
   * Approving also flips the user's isVerified flag. Admin-only: asserts on
   * `actor` rather than merely recording whoever the caller claims to be.
   */
  approve(id: string, actor: Actor, note?: string): Promise<VerificationRequest>;
  reject(id: string, actor: Actor, note: string): Promise<VerificationRequest>;
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
  /**
   * Replay guard for the payment webhook.
   *
   * Payment providers retry webhooks they believe failed, and Razorpay
   * explicitly may deliver the same event more than once. Without this, a
   * retry re-grants the tier and extends the period again.
   */
  findOrderByPaymentId(paymentId: string): Promise<SubscriptionOrder | null>;
  /**
   * Order-level replay guard.
   *
   * Distinct from `findOrderByPaymentId`: a provider retry reuses the payment
   * id, but a duplicate or resubmitted webhook can carry a NEW payment id for
   * an order that was already settled. Guarding only on payment id lets the
   * same order be granted twice.
   */
  findOrderById(orderId: string): Promise<SubscriptionOrder | null>;
  /**
   * Records a pending order before checkout opens.
   *
   * `amountMinor` is stored so the webhook can check what was paid against the
   * price at the moment the order was created, rather than today's price list.
   */
  createOrder(
    userId: string,
    tier: SubscriptionTier,
    razorpayOrderId: string,
    amountMinor: number,
  ): Promise<SubscriptionOrder>;
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
  /**
   * Atomically records that `newUserId` was referred by `ownerUserId` and
   * credits the owner.
   *
   * Deliberately MECHANICAL. This used to be `applyCode(code, newUserId)`,
   * which also held four anti-fraud rules — unknown code, self-referral,
   * reciprocal farming, already-applied — expressed as plain `Error` message
   * strings that the gateway surfaced verbatim to the user. That put policy
   * inside the swap boundary: a new database implementation had to re-derive
   * all four rules *and* reproduce four exact English sentences, or the guards
   * would vanish with no type error and no failing test.
   *
   * The rules now live in `referrals.service.ts`. What stays here is the one
   * part that genuinely needs the database: claiming the referral and paying
   * the reward in a single transaction, so two concurrent submissions cannot
   * both credit the owner. `rewardPoints` is a parameter because the amount is
   * a business decision, not a storage one.
   *
   * Throws `RepositoryConflictError` when a referral was already applied.
   */
  claimReferral(input: {
    newUserId: string;
    ownerUserId: string;
    rewardPoints: number;
  }): Promise<Referral>;
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
  resolveReport(id: string, actor: Actor): Promise<Report>;
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
  set(
    key: string,
    enabled: boolean,
    actor: Actor,
    description?: string,
  ): Promise<FeatureFlag>;
}

export interface RateLimitRepository {
  /**
   * Atomically increments the counter for `key` and reports whether the caller
   * is over `limit` within `windowMs`.
   *
   * ATOMICALLY is a requirement, not a description of one implementation. A
   * read-then-branch version of this shipped once and was wrong: every
   * concurrent request at window rollover saw the same pre-increment count and
   * passed, so a caller could burst, wait one window, and burst again without
   * limit. `allowed` must be derived from the count the store actually wrote.
   *
   * The window is FIXED, not sliding: a refused call must not push `resetAt`
   * further out, or a client honouring Retry-After extends its own lockout on
   * every retry and never recovers.
   *
   * MUST THROW on a non-positive or non-finite `windowMs` rather than
   * returning. Such a window writes an already-expired entry, so every
   * subsequent call takes the reset path and throttling is silently off — the
   * same failure as the bug above, reached by configuration instead of by a
   * race. Failing loudly is the contract; this is stated here because it is
   * the kind of guard a second implementation would quietly omit.
   */
  hit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: Date }>;
}

// ─────────────────────────── Phone verification ───────────────────────────

export interface PhoneChallenge {
  userId: string;
  phone: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
}

export interface PhoneVerificationRepository {
  /** Replaces any in-flight challenge, so a resend invalidates the old code. */
  start(input: {
    userId: string;
    phone: string;
    codeHash: string;
    expiresAt: Date;
  }): Promise<PhoneChallenge>;
  find(userId: string): Promise<PhoneChallenge | null>;
  /** Returns the new attempt count, for lockout after too many tries. */
  recordAttempt(userId: string): Promise<number>;
  clear(userId: string): Promise<void>;
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
  phoneVerification: PhoneVerificationRepository;
  health: HealthRepository;
}
