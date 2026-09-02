import "server-only";

import { z } from "zod";
import { externalUrl } from "../schemas";
import { defineOperation } from "../core";
import * as account from "@/lib/services/account.service";
import * as messaging from "@/lib/services/messaging.service";

const page = {
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
};

// ─────────────────────────── Profile ───────────────────────────

export const updateProfile = defineOperation({
  name: "profile.update",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    name: z.string().trim().min(2).max(80).optional(),
    bio: z.string().trim().max(2000).optional(),
    location: z.string().trim().max(120).optional(),
    title: z.string().trim().max(120).optional(),
    skills: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    hourlyRate: z.number().min(0).max(1_000_000).optional(),
    serviceRadiusKm: z.number().min(0).max(500).optional(),
    isAvailable: z.boolean().optional(),
    companyName: z.string().trim().max(120).optional(),
    industry: z.string().trim().max(120).optional(),
    portfolioLinks: z.array(externalUrl).max(10).optional(),
  }),
  // No id: this only ever updates the caller's own profile.
  handler: (input, { user }) => account.updateMyProfile(user, input),
});

export const publicProfile = defineOperation({
  name: "profile.public",
  kind: "query",
  access: "authenticated",
  input: z.object({ userId: z.string().min(1) }),
  handler: ({ userId }, { user }) => account.getPublicProfile(user, userId),
});

// ─────────────────────────── Discovery ───────────────────────────

export const searchProviders = defineOperation({
  name: "search.providers",
  kind: "query",
  access: "authenticated",
  input: z.object({
    query: z.string().trim().max(120).optional(),
    skills: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    minRating: z.number().min(0).max(5).optional(),
    maxHourlyRate: z.number().min(0).optional(),
    location: z.string().trim().max(120).optional(),
    role: z.enum(["digital", "local"]).optional(),
    ...page,
  }),
  handler: (input) => account.searchProviders(input),
});

// ─────────────────────────── Notifications ───────────────────────────

export const listNotifications = defineOperation({
  name: "notifications.list",
  kind: "query",
  access: "authenticated",
  input: z.object({ unreadOnly: z.boolean().optional(), ...page }),
  handler: (input, { user }) => account.listNotifications(user, input),
});

export const countUnreadNotifications = defineOperation({
  name: "notifications.unreadCount",
  kind: "query",
  access: "authenticated",
  input: z.void(),
  handler: (_input, { user }) => account.countUnreadNotifications(user),
});

export const markNotificationRead = defineOperation({
  name: "notifications.markRead",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ id: z.string().min(1) }),
  handler: ({ id }, { user }) => account.markNotificationRead(user, id),
});

export const markAllNotificationsRead = defineOperation({
  name: "notifications.markAllRead",
  kind: "mutation",
  access: "authenticated",
  input: z.void(),
  handler: async (_input, { user }) => ({
    count: await account.markAllNotificationsRead(user),
  }),
});

export const getNotificationPrefs = defineOperation({
  name: "notifications.getPrefs",
  kind: "query",
  access: "authenticated",
  input: z.void(),
  handler: (_input, { user }) => account.getNotificationPrefs(user),
});

export const updateNotificationPrefs = defineOperation({
  name: "notifications.updatePrefs",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    push: z.boolean().optional(),
    email: z.boolean().optional(),
    quotes: z.boolean().optional(),
    bookings: z.boolean().optional(),
    messages: z.boolean().optional(),
    marketing: z.boolean().optional(),
  }),
  handler: (input, { user }) => account.updateNotificationPrefs(user, input),
});

// ─────────────────────────── Messaging ───────────────────────────

export const listConversations = defineOperation({
  name: "messages.listConversations",
  kind: "query",
  access: "authenticated",
  input: z.object(page),
  handler: (input, { user }) => messaging.listConversations(user, input),
});

export const getThread = defineOperation({
  name: "messages.thread",
  kind: "query",
  access: "authenticated",
  rateTier: "message",
  input: z.object({ conversationId: z.string().min(1), ...page }),
  handler: ({ conversationId, ...params }, { user }) =>
    messaging.getThread(user, conversationId, params),
});

export const sendMessage = defineOperation({
  name: "messages.send",
  kind: "mutation",
  access: "authenticated",
  rateTier: "message",
  input: z
    .object({
      recipientId: z.string().min(1),
      // No min(1) here: the requirement is "text OR a file", enforced below.
      // Keeping min(1) would have made a photo with no caption unsendable.
      text: z.string().trim().max(4000),
      conversationId: z.string().min(1).optional(),
      /** Id from uploads.prepare/confirm, not a URL — see resolveAttachment. */
      attachmentUploadId: z.string().min(1).optional(),
    })
    .refine((v) => v.text.length > 0 || Boolean(v.attachmentUploadId), {
      message: "Type something or attach a file",
      path: ["text"],
    }),
  handler: (input, { user }) => messaging.sendMessage(user, input),
});

export const deleteMessage = defineOperation({
  name: "messages.delete",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    conversationId: z.string().min(1),
    messageId: z.string().min(1),
  }),
  handler: async ({ conversationId, messageId }, { user }) => {
    await messaging.deleteMessage(user, conversationId, messageId);
    return { ok: true as const };
  },
});

export const heartbeat = defineOperation({
  name: "presence.heartbeat",
  kind: "mutation",
  access: "authenticated",
  rateTier: "message",
  input: z.void(),
  handler: async (_input, { user }) => {
    await messaging.recordPresence(user);
    return { ok: true as const };
  },
});

// ─────────────────────────── Moderation ───────────────────────────

export const blockUser = defineOperation({
  name: "moderation.block",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ userId: z.string().min(1) }),
  handler: async ({ userId }, { user }) => {
    await account.blockUser(user, userId);
    return { ok: true as const };
  },
});

export const unblockUser = defineOperation({
  name: "moderation.unblock",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ userId: z.string().min(1) }),
  handler: async ({ userId }, { user }) => {
    await account.unblockUser(user, userId);
    return { ok: true as const };
  },
});

export const reportUser = defineOperation({
  name: "moderation.report",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    reportedId: z.string().min(1),
    targetType: z.enum(["user", "message", "requirement", "review"]),
    targetId: z.string().min(1).optional(),
    reason: z.string().trim().min(3).max(120),
    details: z.string().trim().max(2000).optional(),
  }),
  handler: async (input, { user }) => {
    await account.reportUser(user, input);
    return { ok: true as const };
  },
});

// ─────────────────────────── Referrals ───────────────────────────

export const myReferral = defineOperation({
  name: "referrals.mine",
  kind: "query",
  access: "authenticated",
  input: z.void(),
  handler: (_input, { user }) => account.getMyReferral(user),
});
