import "server-only";

/**
 * Admin operations.
 *
 * Every one is `access: "admin"`, which the gateway checks server-side BEFORE
 * the handler runs. That is the gate — the pages under /admin also redirect,
 * but only so a non-admin sees a sensible page rather than an error; the
 * redirect is not what protects the data.
 */
import { z } from "zod";
import { defineOperation } from "../core";
import * as admin from "@/lib/services/admin.service";
import { USER_ROLES } from "@/lib/repositories/types";

const page = {
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
};

export const overview = defineOperation({
  name: "admin.overview",
  kind: "query",
  access: "admin",
  input: z.void(),
  handler: () => admin.getOverview(),
});

// ─────────────────────────── Users ───────────────────────────

export const listUsers = defineOperation({
  name: "admin.users.list",
  kind: "query",
  access: "admin",
  input: z.object({
    role: z.enum(USER_ROLES).optional(),
    query: z.string().trim().max(120).optional(),
    isSuspended: z.boolean().optional(),
    ...page,
  }),
  handler: (input, { user }) => admin.listUsers(user, input),
});

export const setSuspended = defineOperation({
  name: "admin.users.setSuspended",
  kind: "mutation",
  access: "admin",
  input: z.object({ userId: z.string().min(1), suspended: z.boolean() }),
  handler: ({ userId, suspended }, { user }) =>
    admin.setUserSuspended(user, userId, suspended),
});

export const setRole = defineOperation({
  name: "admin.users.setRole",
  kind: "mutation",
  access: "admin",
  input: z.object({
    userId: z.string().min(1),
    role: z.enum(USER_ROLES),
  }),
  handler: ({ userId, role }, { user }) =>
    admin.setUserRole(user, userId, role),
});

/** Irreversible. Anonymises the row, wipes storage objects, deletes identity. */
export const eraseUser = defineOperation({
  name: "admin.users.erase",
  kind: "mutation",
  access: "admin",
  input: z.object({
    userId: z.string().min(1),
    // Typed confirmation, so this can't be triggered by a stray click or a
    // replayed request.
    confirm: z.literal("ERASE"),
  }),
  handler: ({ userId }, { user }) => admin.eraseUser(user, userId),
});

// ─────────────────────────── Disputes ───────────────────────────

export const listDisputes = defineOperation({
  name: "admin.disputes.list",
  kind: "query",
  access: "admin",
  input: z.object({
    status: z.enum(["open", "under_review", "resolved", "rejected"]).optional(),
    ...page,
  }),
  handler: (input) => admin.listDisputes(input),
});

export const resolveDispute = defineOperation({
  name: "admin.disputes.resolve",
  kind: "mutation",
  access: "admin",
  input: z.object({
    disputeId: z.string().min(1),
    resolution: z.string().trim().min(10, "Explain the decision").max(2000),
    outcome: z.enum(["resolved", "rejected"]),
  }),
  handler: ({ disputeId, resolution, outcome }, { user }) =>
    admin.resolveDispute(user, disputeId, resolution, outcome),
});

// ─────────────────────────── Verification ───────────────────────────

export const listVerifications = defineOperation({
  name: "admin.verification.list",
  kind: "query",
  access: "admin",
  input: z.object({
    status: z.enum(["pending", "approved", "rejected"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  handler: (input, { user }) => admin.listVerificationQueue(user, input),
});

export const getVerificationDocuments = defineOperation({
  name: "admin.verification.documents",
  kind: "query",
  access: "admin",
  input: z.object({ requestId: z.string().min(1) }),
  handler: ({ requestId }, { user }) =>
    admin.getVerificationDocuments(user, requestId),
});

export const approveVerification = defineOperation({
  name: "admin.verification.approve",
  kind: "mutation",
  access: "admin",
  input: z.object({
    requestId: z.string().min(1),
    note: z.string().trim().max(500).optional(),
  }),
  handler: ({ requestId, note }, { user }) =>
    admin.approveVerification(user, requestId, note),
});

export const rejectVerification = defineOperation({
  name: "admin.verification.reject",
  kind: "mutation",
  access: "admin",
  input: z.object({
    requestId: z.string().min(1),
    note: z.string().trim().min(5, "Tell them what was wrong").max(500),
  }),
  handler: ({ requestId, note }, { user }) =>
    admin.rejectVerification(user, requestId, note),
});

// ─────────────────────────── Moderation ───────────────────────────

export const listFlaggedMessages = defineOperation({
  name: "admin.moderation.flaggedMessages",
  kind: "query",
  access: "admin",
  input: z.object(page),
  handler: (input) => admin.listFlaggedMessages(input),
});

export const clearMessageFlag = defineOperation({
  name: "admin.moderation.clearFlag",
  kind: "mutation",
  access: "admin",
  input: z.object({ messageId: z.string().min(1) }),
  handler: ({ messageId }, { user }) => admin.clearMessageFlag(user, messageId),
});

export const listReports = defineOperation({
  name: "admin.moderation.reports",
  kind: "query",
  access: "admin",
  input: z.object({ status: z.string().max(30).optional(), ...page }),
  handler: (input) => admin.listReports(input),
});

export const resolveReport = defineOperation({
  name: "admin.moderation.resolveReport",
  kind: "mutation",
  access: "admin",
  input: z.object({ reportId: z.string().min(1) }),
  handler: ({ reportId }, { user }) => admin.resolveReport(user, reportId),
});

// ─────────────────────────── Fraud, revenue, flags, audit ───────────────────

export const fraud = defineOperation({
  name: "admin.fraud",
  kind: "query",
  access: "admin",
  input: z.void(),
  handler: (_input, { user }) => admin.getFraudView(user),
});

export const revenue = defineOperation({
  name: "admin.revenue",
  kind: "query",
  access: "admin",
  input: z.void(),
  handler: () => admin.getRevenueView(),
});

export const listFlags = defineOperation({
  name: "admin.flags.list",
  kind: "query",
  access: "admin",
  input: z.void(),
  handler: () => admin.listFlags(),
});

export const setFlag = defineOperation({
  name: "admin.flags.set",
  kind: "mutation",
  access: "admin",
  input: z.object({ key: z.string().min(1).max(60), enabled: z.boolean() }),
  handler: ({ key, enabled }, { user }) => admin.setFlag(user, key, enabled),
});

export const listAudit = defineOperation({
  name: "admin.audit.list",
  kind: "query",
  access: "admin",
  input: z.object({
    actorId: z.string().min(1).optional(),
    action: z.string().max(60).optional(),
    ...page,
  }),
  handler: (input) => admin.listAuditEvents(input),
});
