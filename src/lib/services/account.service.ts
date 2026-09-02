import "server-only";

/**
 * Profile, settings, notifications and discovery.
 *
 * The public-profile path is the one to watch: it must return the PII-free
 * projection, because anyone signed in can look at anyone's provider page.
 */
import { repo } from "@/lib/repositories";
import type {
  Notification,
  NotificationPrefs,
  PublicUser,
  Review,
  PortfolioItem,
  User,
} from "@/lib/repositories/types";
import { GatewayError } from "@/lib/gateway/types";

// ─────────────────────────── Profile ───────────────────────────

export interface UpdateProfileInput {
  name?: string;
  bio?: string;
  location?: string;
  title?: string;
  skills?: string[];
  hourlyRate?: number;
  serviceRadiusKm?: number;
  isAvailable?: boolean;
  companyName?: string;
  industry?: string;
  portfolioLinks?: string[];
}

/** Updates the caller's OWN profile. There is no id parameter by design. */
export async function updateMyProfile(
  actor: User,
  input: UpdateProfileInput,
): Promise<User> {
  // `role` is deliberately absent from UpdateUserInput, so no amount of extra
  // form fields can escalate here.
  return repo.users.update(actor.id, input);
}

export interface PublicProfile {
  user: PublicUser;
  reviews: Review[];
  reviewCount: number;
  portfolio: PortfolioItem[];
  isOnline: boolean;
  /** Existing conversation with this person, if any. */
  conversationId: string | null;
}

/**
 * Someone else's public profile.
 *
 * Uses `searchProviders` rather than `findById` so the response is the
 * PII-free `PublicUser` projection — `findById` returns email, phone and FCM
 * token, none of which belong on a public page.
 */
export async function getPublicProfile(
  actor: User,
  userId: string,
): Promise<PublicProfile> {
  const full = await repo.users.findById(userId);
  if (!full || full.isSuspended) {
    throw GatewayError.notFound("Profile not found");
  }

  const [reviews, portfolio, presence, conversation] = await Promise.all([
    repo.reviews.list({ subjectId: userId, limit: 10 }),
    repo.portfolio.listByUser(userId, { limit: 12 }),
    repo.presence.get(userId),
    repo.messages.findConversationBetween(actor.id, userId),
  ]);

  // Viewing someone's profile is the analytics signal; self-views don't count
  // (the repository drops those).
  await repo.analytics.recordProfileView(userId, actor.id).catch(() => {});

  const publicUser: PublicUser = {
    id: full.id,
    name: full.name,
    role: full.role,
    title: full.title,
    bio: full.bio,
    location: full.location,
    avatarUrl: full.avatarUrl,
    skills: full.skills,
    portfolioLinks: full.portfolioLinks,
    hourlyRate: full.hourlyRate,
    rating: full.rating,
    reviewsCount: full.reviewsCount,
    completedGigs: full.completedGigs,
    onTimeRate: full.onTimeRate,
    isVerified: full.isVerified,
    isPremium: full.isPremium,
    isAvailable: full.isAvailable,
    serviceRadiusKm: full.serviceRadiusKm,
    companyName: full.companyName,
    industry: full.industry,
    createdAt: full.createdAt,
  };

  return {
    user: publicUser,
    reviews: reviews.items,
    reviewCount: reviews.total ?? reviews.items.length,
    portfolio: portfolio.items,
    isOnline: presence?.isOnline ?? false,
    conversationId: conversation?.id ?? null,
  };
}

// ─────────────────────────── Discovery ───────────────────────────

export interface SearchProvidersInput {
  query?: string;
  skills?: string[];
  minRating?: number;
  maxHourlyRate?: number;
  location?: string;
  role?: "digital" | "local";
  limit?: number;
  offset?: number;
}

export async function searchProviders(input: SearchProvidersInput) {
  // Returns PublicUser — enforced by the repository's return type.
  return repo.users.searchProviders(input);
}

// ─────────────────────────── Notifications ───────────────────────────

export async function listNotifications(
  actor: User,
  params: { unreadOnly?: boolean; limit?: number; offset?: number } = {},
) {
  return repo.notifications.list(actor.id, params);
}

export async function markNotificationRead(
  actor: User,
  notificationId: string,
): Promise<Notification> {
  // Scoped by userId inside the repository, so this cannot mark someone
  // else's notification read even with a valid id.
  return repo.notifications.markRead(notificationId, actor.id);
}

export async function markAllNotificationsRead(actor: User): Promise<number> {
  return repo.notifications.markAllRead(actor.id);
}

/**
 * Unread count for the sidebar badge.
 *
 * Its own operation rather than counting a page of `listNotifications`. The
 * badge renders in the authenticated shell, so it runs on EVERY page: paging
 * rows in to length them would put a list query on every render to produce one
 * integer, and would undercount past the page size.
 */
export async function countUnreadNotifications(actor: User): Promise<number> {
  return repo.notifications.countUnread(actor.id);
}

export async function getNotificationPrefs(
  actor: User,
): Promise<NotificationPrefs> {
  return repo.notifications.getPrefs(actor.id);
}

export async function updateNotificationPrefs(
  actor: User,
  prefs: Partial<Omit<NotificationPrefs, "userId">>,
): Promise<NotificationPrefs> {
  return repo.notifications.setPrefs(actor.id, prefs);
}

// ─────────────────────────── Moderation ───────────────────────────

export async function blockUser(actor: User, targetId: string): Promise<void> {
  if (targetId === actor.id) {
    throw GatewayError.validation("You can't block yourself.");
  }
  await repo.moderation.blockUser(actor.id, targetId);
}

export async function unblockUser(actor: User, targetId: string): Promise<void> {
  await repo.moderation.unblockUser(actor.id, targetId);
}

export async function reportUser(
  actor: User,
  input: {
    reportedId: string;
    targetType: string;
    targetId?: string;
    reason: string;
    details?: string;
  },
): Promise<void> {
  if (input.reportedId === actor.id) {
    throw GatewayError.validation("You can't report yourself.");
  }
  await repo.moderation.createReport({ reporterId: actor.id, ...input });
}

// ─────────────────────────── Referrals ───────────────────────────

export async function getMyReferral(actor: User) {
  // Deliberately NOT Promise.all with `stats()`: that calls getOrCreateCode
  // internally, so running both in parallel raced two inserts for the same new
  // user. The counters live on the referral row anyway, so one read serves both.
  const referral = await repo.referrals.getOrCreateCode(actor.id);
  const leaderboard = await repo.referrals.leaderboard(10);

  return {
    referral,
    stats: {
      signupCount: referral.signupCount,
      rewardPoints: referral.rewardPoints,
    },
    leaderboard,
  };
}
