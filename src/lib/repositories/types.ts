/**
 * Domain types for the SRN web app.
 *
 * These are deliberately NOT Prisma's generated types. Feature code speaks these
 * shapes, so replacing the Prisma/SQLite implementation with a different database
 * (or a document store, or a remote API) changes only the mapping layer inside
 * src/lib/repositories/prisma/ — never a page, component, or route handler.
 *
 * Shapes are ported from the mobile app: src/types/roles.ts and the generated
 * API schemas in lib/api-client-react/src/generated/api.schemas.ts.
 */

// ─────────────────────────── Roles ───────────────────────────

export const USER_ROLES = [
  "business",
  "customer",
  "digital",
  "local",
  "admin",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Ported verbatim from mobile src/types/roles.ts ROLE_LABELS. */
export const ROLE_LABELS: Record<UserRole, string> = {
  business: "Business / Startup",
  customer: "Personal / Customer",
  digital: "Digital Skill Provider",
  local: "Local Service Provider",
  admin: "Administrator",
};

/** Ported verbatim from mobile src/types/roles.ts ROLE_COLORS. */
export const ROLE_COLORS: Record<UserRole, string> = {
  business: "#7c3aed",
  customer: "#2563eb",
  digital: "#0d9488",
  local: "#ea580c",
  admin: "#dc2626",
};

/** Roles that bid on requirements rather than post them. */
export const PROVIDER_ROLES: UserRole[] = ["digital", "local"];
/** Roles that post requirements rather than bid on them. */
export const SEEKER_ROLES: UserRole[] = ["business", "customer"];

export function isProviderRole(role: UserRole): boolean {
  return PROVIDER_ROLES.includes(role);
}

export function isSeekerRole(role: UserRole): boolean {
  return SEEKER_ROLES.includes(role);
}

// ─────────────────────────── Status unions ───────────────────────────

export type RequirementStatus =
  | "open"
  | "in_progress"
  | "closed"
  | "cancelled";

export type QuoteStatus =
  | "pending"
  | "shortlisted"
  | "accepted"
  | "rejected"
  | "countered"
  | "withdrawn";

export type BookingStatus =
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "disputed";

export type DisputeStatus = "open" | "under_review" | "resolved" | "rejected";

export type VerificationStatus = "pending" | "approved" | "rejected";

export type SubscriptionTier = "free" | "pro" | "elite";

export type UploadContext = "avatar" | "portfolio" | "document" | "evidence";

// ─────────────────────────── Entities ───────────────────────────

export interface User {
  id: string; // Firebase uid
  email: string;
  name: string;
  role: UserRole;

  phone?: string | null;
  bio?: string | null;
  location?: string | null;
  avatarUrl?: string | null;
  isVerified: boolean;
  isPremium: boolean;
  isSuspended: boolean;
  phoneVerified: boolean;

  title?: string | null;
  skills: string[];
  portfolioLinks: string[];
  hourlyRate?: number | null;
  rating: number;
  reviewsCount: number;
  completedGigs: number;
  onTimeRate?: number | null;
  rehireCount: number;
  aiTrustScore?: number | null;
  serviceRadiusKm?: number | null;
  isAvailable: boolean;

  companyName?: string | null;
  industry?: string | null;
  postedRequirementsCount: number;

  privileges: string[];
  fcmToken?: string | null;
  deletionRequestedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface Requirement {
  id: string;
  creatorId: string;
  title: string;
  category: string;
  description: string;
  skillsNeeded: string[];
  minBudget: number;
  maxBudget: number;
  location?: string | null;
  status: RequirementStatus;
  createdAt: Date;
  updatedAt: Date;
  /** Populated by list/get calls that join the creator. */
  creator?: Pick<User, "id" | "name" | "avatarUrl" | "role"> | null;
  /** Populated where a screen shows a bid count. */
  quoteCount?: number;
}

export interface Quote {
  id: string;
  requirementId: string;
  senderId: string;
  receiverId: string;
  amount: number;
  durationDays: number;
  message?: string | null;
  status: QuoteStatus;
  counterOfQuoteId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  sender?: Pick<User, "id" | "name" | "avatarUrl" | "rating" | "title"> | null;
  requirement?: Pick<Requirement, "id" | "title" | "maxBudget"> | null;
}

export interface Booking {
  id: string;
  quoteId?: string | null;
  requirementId?: string | null;
  customerId: string;
  providerId: string;
  amount: number;
  status: BookingStatus;
  scheduledFor?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  customer?: Pick<User, "id" | "name" | "avatarUrl"> | null;
  provider?: Pick<User, "id" | "name" | "avatarUrl"> | null;
  requirement?: Pick<Requirement, "id" | "title"> | null;
  hasReview?: boolean;
}

export interface Review {
  id: string;
  bookingId: string;
  authorId: string;
  subjectId: string;
  rating: number;
  comment?: string | null;
  isFlagged: boolean;
  createdAt: Date;
  author?: Pick<User, "id" | "name" | "avatarUrl"> | null;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  lastMessageAt: Date;
  lastMessageText?: string | null;
  createdAt: Date;
  /** The other participant, resolved relative to the requesting user. */
  counterpart?: Pick<User, "id" | "name" | "avatarUrl"> | null;
  unreadCount?: number;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  text: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentSize?: string | null;
  quoteId?: string | null;
  read: boolean;
  isFlagged: boolean;
  isDeleted: boolean;
  createdAt: Date;
}

export interface Dispute {
  id: string;
  bookingId: string;
  raisedById: string;
  reason: string;
  details: string;
  evidenceUrls: string[];
  status: DisputeStatus;
  resolution?: string | null;
  resolvedById?: string | null;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  raisedBy?: Pick<User, "id" | "name" | "avatarUrl"> | null;
  booking?: Pick<Booking, "id" | "amount" | "customerId" | "providerId"> | null;
}

export interface VerificationRequest {
  id: string;
  userId: string;
  docType: string;
  docUrls: string[];
  status: VerificationStatus;
  reviewNote?: string | null;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
  createdAt: Date;
  user?: Pick<User, "id" | "name" | "email" | "role" | "avatarUrl"> | null;
}

export interface PortfolioItem {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  projectUrl?: string | null;
  isFeatured: boolean;
  likeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkingHours {
  id: string;
  userId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isEnabled: boolean;
}

export interface BlockedDate {
  id: string;
  userId: string;
  date: Date;
  reason?: string | null;
}

export interface Subscription {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  status: string;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  read: boolean;
  createdAt: Date;
}

export interface NotificationPrefs {
  userId: string;
  push: boolean;
  email: boolean;
  quotes: boolean;
  bookings: boolean;
  messages: boolean;
  marketing: boolean;
}

export interface Referral {
  userId: string;
  code: string;
  referredById?: string | null;
  signupCount: number;
  rewardPoints: number;
  createdAt: Date;
}

export interface Presence {
  userId: string;
  isOnline: boolean;
  lastHeartbeat: Date;
}

export interface Upload {
  id: string;
  userId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  context: UploadContext;
  entityId?: string | null;
  storageKey: string;
  publicUrl?: string | null;
  confirmed: boolean;
  createdAt: Date;
}

export interface AuditEvent {
  id: string;
  actorId?: string | null;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  createdAt: Date;
  actor?: Pick<User, "id" | "name" | "email"> | null;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description?: string | null;
  updatedAt: Date;
}

export interface Report {
  id: string;
  reporterId: string;
  reportedId: string;
  targetType: string;
  targetId?: string | null;
  reason: string;
  details?: string | null;
  status: string;
  resolvedAt?: Date | null;
  createdAt: Date;
}

// ─────────────────────────── Query helpers ───────────────────────────

/**
 * Cursor-free offset pagination. Kept simple deliberately: the mobile screens
 * this ports from use limit/offset lists, not infinite cursors.
 */
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PageParams {
  limit?: number;
  offset?: number;
}

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** Clamps caller-supplied paging so a hostile query can't ask for everything. */
export function normalizePageParams(params: PageParams = {}): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(
    Math.max(1, Math.floor(params.limit ?? DEFAULT_PAGE_LIMIT)),
    MAX_PAGE_LIMIT,
  );
  const offset = Math.max(0, Math.floor(params.offset ?? 0));
  return { limit, offset };
}
