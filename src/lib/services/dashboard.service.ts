import "server-only";

/**
 * Dashboard read models.
 *
 * Assembling this in a service rather than in the page keeps the repository
 * layer out of the UI, and means the same numbers are available over HTTP to a
 * future mobile client without duplicating the aggregation.
 */
import { repo } from "@/lib/repositories";
import {
  isProviderRole,
  type Booking,
  type Quote,
  type Requirement,
  type User,
} from "@/lib/repositories/types";

export interface SeekerDashboard {
  kind: "seeker";
  stats: {
    openRequirements: number;
    pendingQuotes: number;
    activeBookings: number;
    unreadMessages: number;
  };
  requirements: Requirement[];
  requirementCount: number;
  quotes: Quote[];
  bookings: Booking[];
}

export interface ProviderDashboard {
  kind: "provider";
  stats: {
    profileViews: number;
    acceptanceRate: number;
    quotesSent: number;
    quotesAccepted: number;
    totalEarnings: number;
    completedBookings: number;
    unreadMessages: number;
  };
  feed: Requirement[];
  quotes: Quote[];
  bookings: Booking[];
}

export type DashboardData = SeekerDashboard | ProviderDashboard;

/** `Page.total` is optional by design; fall back so counters never render blank. */
function countOf(page: { total?: number; items: unknown[] }): number {
  return page.total ?? page.items.length;
}

export async function getDashboard(user: User): Promise<DashboardData> {
  return isProviderRole(user.role)
    ? providerDashboard(user)
    : seekerDashboard(user);
}

async function seekerDashboard(user: User): Promise<SeekerDashboard> {
  const [
    requirements,
    bookings,
    quotes,
    unreadMessages,
    openRequirements,
    confirmed,
    inProgress,
  ] = await Promise.all([
    repo.requirements.list({ creatorId: user.id, limit: 5 }),
    repo.bookings.list({ customerId: user.id, limit: 5 }),
    repo.quotes.list({ receiverId: user.id, status: "pending", limit: 5 }),
    repo.messages.countUnread(user.id),
    // Headline stats need counts over ALL rows — deriving them by filtering a
    // 5-row page capped every stat at 5, and read 0 when the newest rows
    // happened to be closed.
    repo.requirements.list({ creatorId: user.id, status: "open", limit: 1 }),
    repo.bookings.list({ customerId: user.id, status: "confirmed", limit: 1 }),
    repo.bookings.list({ customerId: user.id, status: "in_progress", limit: 1 }),
  ]);

  return {
    kind: "seeker",
    stats: {
      openRequirements: countOf(openRequirements),
      pendingQuotes: countOf(quotes),
      activeBookings: countOf(confirmed) + countOf(inProgress),
      unreadMessages,
    },
    requirements: requirements.items,
    requirementCount: countOf(requirements),
    quotes: quotes.items,
    bookings: bookings.items,
  };
}

async function providerDashboard(user: User): Promise<ProviderDashboard> {
  const [feed, quotes, bookings, unreadMessages, analytics] = await Promise.all([
    repo.requirements.feedForProvider(user.id, { limit: 5 }),
    repo.quotes.list({ senderId: user.id, limit: 5 }),
    repo.bookings.list({ providerId: user.id, limit: 5 }),
    repo.messages.countUnread(user.id),
    repo.analytics.providerAnalytics(user.id, 30),
  ]);

  return {
    kind: "provider",
    stats: {
      profileViews: analytics.profileViews,
      acceptanceRate: analytics.acceptanceRate,
      quotesSent: analytics.quotesSent,
      quotesAccepted: analytics.quotesAccepted,
      totalEarnings: analytics.totalEarnings,
      completedBookings: analytics.completedBookings,
      unreadMessages,
    },
    feed: feed.items,
    quotes: quotes.items,
    bookings: bookings.items,
  };
}
