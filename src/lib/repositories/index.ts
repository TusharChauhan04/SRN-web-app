import "server-only";

/**
 * The repository registry — the single wiring point for the whole data layer.
 *
 * Feature code imports `repositories` (or `repo`) from here and nothing else.
 * To move to a real database, build a second set of classes implementing the
 * interfaces in ./interfaces and swap the object below. No page, component, or
 * route handler changes. See DATABASE.md for the full procedure.
 *
 * `server-only` is load-bearing: importing this module INSTANTIATES every
 * repository, so a client component importing it would drag PrismaClient into
 * the browser bundle. This module also deliberately does NOT re-export the
 * domain types — client components must import those from ./types directly,
 * which is a types-only module with no runtime cost.
 */
import type { Repositories } from "./interfaces";
import {
  PrismaBookingRepository,
  PrismaQuoteRepository,
  PrismaRequirementRepository,
  PrismaReviewRepository,
} from "./prisma/marketplace";
import { PrismaMessageRepository } from "./prisma/messaging";
import {
  PrismaAuditRepository,
  PrismaFeatureFlagRepository,
  PrismaHealthRepository,
  PrismaNotificationRepository,
  PrismaPresenceRepository,
  PrismaRateLimitRepository,
  PrismaReferralRepository,
  PrismaPhoneVerificationRepository,
  PrismaUploadRepository,
} from "./prisma/platform";
import {
  PrismaAnalyticsRepository,
  PrismaAvailabilityRepository,
  PrismaPortfolioRepository,
  PrismaSubscriptionRepository,
} from "./prisma/provider";
import {
  PrismaDisputeRepository,
  PrismaModerationRepository,
  PrismaVerificationRepository,
} from "./prisma/trust";
import { PrismaUserRepository } from "./prisma/users";

/**
 * Currently backed by Prisma + Supabase Postgres.
 *
 * Supabase is a deliberate waypoint, not the destination — the intent is to
 * move to Azure once the project is ready. This object is the swap point: if
 * that move is to Azure Database for PostgreSQL it costs a connection string
 * and nothing here changes at all, because the engine is the same.
 */
export const repositories: Repositories = {
  users: new PrismaUserRepository(),
  requirements: new PrismaRequirementRepository(),
  quotes: new PrismaQuoteRepository(),
  bookings: new PrismaBookingRepository(),
  reviews: new PrismaReviewRepository(),
  messages: new PrismaMessageRepository(),
  disputes: new PrismaDisputeRepository(),
  verification: new PrismaVerificationRepository(),
  portfolio: new PrismaPortfolioRepository(),
  availability: new PrismaAvailabilityRepository(),
  subscriptions: new PrismaSubscriptionRepository(),
  notifications: new PrismaNotificationRepository(),
  referrals: new PrismaReferralRepository(),
  presence: new PrismaPresenceRepository(),
  analytics: new PrismaAnalyticsRepository(),
  uploads: new PrismaUploadRepository(),
  moderation: new PrismaModerationRepository(),
  audit: new PrismaAuditRepository(),
  featureFlags: new PrismaFeatureFlagRepository(),
  rateLimit: new PrismaRateLimitRepository(),
  phoneVerification: new PrismaPhoneVerificationRepository(),
  health: new PrismaHealthRepository(),
};

/** Short alias — `repo.users.findById(...)` reads better at call sites. */
export const repo = repositories;

// NOTE: domain types are intentionally NOT re-exported here. Import them from
// "@/lib/repositories/types" instead. Re-exporting made this module a legal
// import path for a client component that only wanted `UserRole`, which would
// have pulled the whole Prisma layer into the browser bundle.
