import "server-only";

import { z } from "zod";
import { externalUrl } from "../schemas";
import { defineOperation } from "../core";
import * as provider from "@/lib/services/provider.service";
import * as subs from "@/lib/services/subscriptions.service";

// ─────────────────────────── Portfolio ───────────────────────────

export const listPortfolio = defineOperation({
  name: "portfolio.listMine",
  kind: "query",
  access: "authenticated",
  input: z.void(),
  handler: (_input, { user }) => provider.listMyPortfolio(user),
});

export const addPortfolioItem = defineOperation({
  name: "portfolio.add",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).optional(),
    imageUrl: externalUrl.optional(),
    projectUrl: externalUrl.optional(),
  }),
  handler: (input, { user }) => provider.addPortfolioItem(user, input),
});

export const updatePortfolioItem = defineOperation({
  name: "portfolio.update",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    id: z.string().min(1),
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    projectUrl: externalUrl.optional(),
  }),
  handler: ({ id, ...rest }, { user }) =>
    provider.updatePortfolioItem(user, id, rest),
});

export const setPortfolioFeatured = defineOperation({
  name: "portfolio.setFeatured",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ id: z.string().min(1), featured: z.boolean() }),
  handler: ({ id, featured }, { user }) =>
    provider.setPortfolioFeatured(user, id, featured),
});

export const deletePortfolioItem = defineOperation({
  name: "portfolio.delete",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ id: z.string().min(1) }),
  handler: async ({ id }, { user }) => {
    await provider.deletePortfolioItem(user, id);
    return { ok: true as const };
  },
});

// ─────────────────────────── Availability ───────────────────────────

export const getAvailability = defineOperation({
  name: "availability.mine",
  kind: "query",
  access: "authenticated",
  input: z.void(),
  handler: (_input, { user }) => provider.getMyAvailability(user),
});

export const setWorkingHours = defineOperation({
  name: "availability.setHours",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    hours: z
      .array(
        z.object({
          dayOfWeek: z.number().int().min(0).max(6),
          // Wall-clock "HH:MM" — the format the repository parses.
          startTime: z.string().regex(/^\d{2}:\d{2}$/),
          endTime: z.string().regex(/^\d{2}:\d{2}$/),
          isEnabled: z.boolean(),
        }),
      )
      .max(7),
  }),
  handler: ({ hours }, { user }) => provider.setMyWorkingHours(user, hours),
});

export const blockDate = defineOperation({
  name: "availability.block",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    // Date-only string; the service normalises to UTC midnight.
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().trim().max(120).optional(),
  }),
  handler: async ({ date, reason }, { user }) => {
    await provider.blockDate(user, new Date(`${date}T00:00:00.000Z`), reason);
    return { ok: true as const };
  },
});

export const unblockDate = defineOperation({
  name: "availability.unblock",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  handler: async ({ date }, { user }) => {
    await provider.unblockDate(user, new Date(`${date}T00:00:00.000Z`));
    return { ok: true as const };
  },
});

// ─────────────────────────── Earnings & analytics ───────────────────────────

export const earnings = defineOperation({
  name: "earnings.mine",
  kind: "query",
  access: "authenticated",
  input: z.void(),
  handler: (_input, { user }) => provider.getMyEarnings(user),
});

export const analytics = defineOperation({
  name: "analytics.mine",
  kind: "query",
  access: "authenticated",
  input: z.object({ days: z.number().int().min(7).max(90).optional() }),
  handler: ({ days }, { user }) => provider.getMyAnalytics(user, days ?? 30),
});

// ─────────────────────────── Uploads ───────────────────────────

export const prepareUpload = defineOperation({
  name: "uploads.prepare",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.string().trim().min(1).max(120),
    sizeBytes: z.number().int().min(1),
    context: z.enum(["avatar", "portfolio", "document", "evidence", "chat"]),
    entityId: z.string().min(1).optional(),
  }),
  handler: (input, { user }) => provider.prepareUpload(user, input),
});

export const confirmUpload = defineOperation({
  name: "uploads.confirm",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ uploadId: z.string().min(1) }),
  handler: ({ uploadId }, { user }) => provider.confirmUpload(user, uploadId),
});

// ─────────────────────────── Subscriptions ───────────────────────────

export const subscriptionView = defineOperation({
  name: "subscriptions.view",
  kind: "query",
  access: "authenticated",
  input: z.void(),
  handler: (_input, { user }) => subs.getSubscriptionView(user),
});

/**
 * Creates a checkout order.
 *
 * `payment` rate tier — the tightest — because each call creates a real order
 * with the payment provider.
 */
export const createCheckout = defineOperation({
  name: "subscriptions.checkout",
  kind: "mutation",
  access: "authenticated",
  rateTier: "payment",
  input: z.object({ tier: z.enum(["pro", "elite"]) }),
  handler: ({ tier }, { user }) => subs.createCheckoutOrder(user, tier),
});

export const cancelSubscription = defineOperation({
  name: "subscriptions.cancel",
  kind: "mutation",
  access: "authenticated",
  rateTier: "payment",
  input: z.void(),
  handler: (_input, { user }) => subs.cancelAtPeriodEnd(user),
});
