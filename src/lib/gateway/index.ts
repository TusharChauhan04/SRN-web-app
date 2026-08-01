import "server-only";

/**
 * The gateway — the single entry point to application data.
 *
 * Pages, components and Server Actions import `gateway` from here. Nothing
 * above this line may import a repository, a service, a Prisma client, or a
 * provider SDK; ESLint enforces it.
 *
 *   import { gateway } from "@/lib/gateway";
 *   const data = await gateway.dashboard.get();
 *
 * The same operations are reachable over HTTP at POST /api/v1/:operation for
 * client components and future external consumers. Both transports run the
 * identical pipeline, so the API cannot drift from what server rendering does.
 */
import { invoke } from "./core";
import type { CompleteOnboardingInput } from "@/lib/services/auth.service";
import * as auth from "./operations/auth";
import * as dashboard from "./operations/dashboard";
import * as req from "./operations/requirements";
import * as book from "./operations/bookings";
import * as acct from "./operations/account";

/** Extracts an operation's validated input type, so call sites stay honest. */
type In<T> = T extends { input: { parse: (v: unknown) => infer R } } ? R : never;

export const gateway = {
  auth: {
    createSession: (input: { credential: string }) =>
      invoke(auth.createSession, input),
    destroySession: (input: { cookieValue: string | null }) =>
      invoke(auth.destroySession, input),
    completeOnboarding: (input: CompleteOnboardingInput) =>
      invoke(auth.completeOnboarding, input),
    me: () => invoke(auth.me, undefined),
  },

  dashboard: {
    get: () => invoke(dashboard.get, undefined),
  },

  requirements: {
    create: (input: In<typeof req.create>) => invoke(req.create, input),
    listMine: (input: In<typeof req.listMine> = {}) =>
      invoke(req.listMine, input),
    feed: (input: In<typeof req.feed> = {}) => invoke(req.feed, input),
    browse: (input: In<typeof req.browse> = {}) => invoke(req.browse, input),
    detail: (input: In<typeof req.detail>) => invoke(req.detail, input),
    setStatus: (input: In<typeof req.setStatus>) => invoke(req.setStatus, input),
    delete: (input: In<typeof req.remove>) => invoke(req.remove, input),
  },

  quotes: {
    submit: (input: In<typeof req.submitQuote>) =>
      invoke(req.submitQuote, input),
    listMine: (input: In<typeof req.listMyQuotes> = {}) =>
      invoke(req.listMyQuotes, input),
    detail: (input: In<typeof req.quoteDetail>) =>
      invoke(req.quoteDetail, input),
    shortlist: (input: In<typeof req.shortlistQuote>) =>
      invoke(req.shortlistQuote, input),
    reject: (input: In<typeof req.rejectQuote>) =>
      invoke(req.rejectQuote, input),
    withdraw: (input: In<typeof req.withdrawQuote>) =>
      invoke(req.withdrawQuote, input),
  },

  bookings: {
    acceptQuote: (input: In<typeof book.acceptQuote>) =>
      invoke(book.acceptQuote, input),
    listMine: (input: In<typeof book.listMine> = {}) =>
      invoke(book.listMine, input),
    detail: (input: In<typeof book.detail>) => invoke(book.detail, input),
    setStatus: (input: In<typeof book.setStatus>) =>
      invoke(book.setStatus, input),
  },

  reviews: {
    create: (input: In<typeof book.createReview>) =>
      invoke(book.createReview, input),
    listFor: (input: In<typeof book.listReviewsFor>) =>
      invoke(book.listReviewsFor, input),
  },

  disputes: {
    raise: (input: In<typeof book.raiseDispute>) =>
      invoke(book.raiseDispute, input),
    listMine: (input: In<typeof book.listMyDisputes> = {}) =>
      invoke(book.listMyDisputes, input),
  },

  profile: {
    update: (input: In<typeof acct.updateProfile>) =>
      invoke(acct.updateProfile, input),
    public: (input: In<typeof acct.publicProfile>) =>
      invoke(acct.publicProfile, input),
  },

  search: {
    providers: (input: In<typeof acct.searchProviders> = {}) =>
      invoke(acct.searchProviders, input),
  },

  notifications: {
    list: (input: In<typeof acct.listNotifications> = {}) =>
      invoke(acct.listNotifications, input),
    markRead: (input: In<typeof acct.markNotificationRead>) =>
      invoke(acct.markNotificationRead, input),
    markAllRead: () => invoke(acct.markAllNotificationsRead, undefined),
    getPrefs: () => invoke(acct.getNotificationPrefs, undefined),
    updatePrefs: (input: In<typeof acct.updateNotificationPrefs>) =>
      invoke(acct.updateNotificationPrefs, input),
  },

  messages: {
    listConversations: (input: In<typeof acct.listConversations> = {}) =>
      invoke(acct.listConversations, input),
    thread: (input: In<typeof acct.getThread>) => invoke(acct.getThread, input),
    send: (input: In<typeof acct.sendMessage>) =>
      invoke(acct.sendMessage, input),
    delete: (input: In<typeof acct.deleteMessage>) =>
      invoke(acct.deleteMessage, input),
  },

  presence: {
    heartbeat: () => invoke(acct.heartbeat, undefined),
  },

  moderation: {
    block: (input: In<typeof acct.blockUser>) => invoke(acct.blockUser, input),
    unblock: (input: In<typeof acct.unblockUser>) =>
      invoke(acct.unblockUser, input),
    report: (input: In<typeof acct.reportUser>) =>
      invoke(acct.reportUser, input),
  },

  referrals: {
    mine: () => invoke(acct.myReferral, undefined),
  },
} as const;

/**
 * Registers every operation for HTTP dispatch.
 *
 * Importing the modules is what populates the registry, so this must reference
 * all of them — an operation that is never imported is not reachable over HTTP.
 */
export function loadOperations(): void {
  void auth;
  void dashboard;
  void req;
  void book;
  void acct;
}

export { getOperation, invoke, registeredOperationNames } from "./core";
export { getContext } from "./context";
export { GatewayError } from "./types";
export type { GatewayErrorBody, GatewayErrorCode } from "./types";
