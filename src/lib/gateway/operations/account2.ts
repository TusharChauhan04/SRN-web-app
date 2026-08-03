import "server-only";

/**
 * Phase 6 operations: phone verification, KYC submission, GDPR, referrals.
 *
 * A separate module from `account.ts` purely so the earlier file is not
 * rewritten — additive changes are easier to review and cannot disturb what
 * already works.
 */
import { z } from "zod";
import { defineOperation } from "../core";
import * as verification from "@/lib/services/verification.service";
import * as gdpr from "@/lib/services/gdpr.service";
import * as referrals from "@/lib/services/referrals.service";

// ─────────────────────────── Phone ───────────────────────────

export const startPhone = defineOperation({
  name: "phone.start",
  kind: "mutation",
  access: "authenticated",
  // `auth` tier: each call sends a message that may cost money.
  rateTier: "auth",
  input: z.object({ phone: z.string().trim().min(8).max(20) }),
  handler: ({ phone }, { user }) =>
    verification.startPhoneVerification(user, phone),
});

export const confirmPhone = defineOperation({
  name: "phone.confirm",
  kind: "mutation",
  access: "authenticated",
  rateTier: "auth",
  input: z.object({ code: z.string().trim().min(4).max(8) }),
  handler: ({ code }, { user }) =>
    verification.confirmPhoneVerification(user, code),
});

// ─────────────────────────── KYC ───────────────────────────

export const kycStatus = defineOperation({
  name: "kyc.status",
  kind: "query",
  access: "authenticated",
  input: z.void(),
  handler: (_input, { user }) => verification.getMyKycStatus(user),
});

export const submitKyc = defineOperation({
  name: "kyc.submit",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    docType: z.enum(["aadhaar", "pan", "gst", "license", "other"]),
    uploadIds: z.array(z.string().min(1)).min(1).max(5),
  }),
  handler: (input, { user }) => verification.submitKyc(user, input),
});

// ─────────────────────────── GDPR ───────────────────────────

export const dataRights = defineOperation({
  name: "gdpr.rights",
  kind: "query",
  access: "authenticated",
  input: z.void(),
  handler: (_input, { user }) => gdpr.getMyDataRights(user),
});

export const exportData = defineOperation({
  name: "gdpr.export",
  kind: "query",
  access: "authenticated",
  // Assembles the user's entire record — expensive, and not something anyone
  // needs repeatedly.
  rateTier: "payment",
  input: z.void(),
  handler: (_input, { user }) => gdpr.exportMyData(user),
});

export const requestDeletion = defineOperation({
  name: "gdpr.requestDeletion",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    // Typed confirmation, matching the admin erase flow — this schedules the
    // permanent removal of an account.
    confirm: z.literal("DELETE"),
  }),
  handler: (_input, { user }) => gdpr.requestDeletion(user),
});

export const cancelDeletion = defineOperation({
  name: "gdpr.cancelDeletion",
  kind: "mutation",
  access: "authenticated",
  input: z.void(),
  handler: (_input, { user }) => gdpr.cancelDeletion(user),
});

// ─────────────────────────── Referrals ───────────────────────────

export const applyReferral = defineOperation({
  name: "referrals.apply",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ code: z.string().trim().min(4).max(20) }),
  handler: async ({ code }, { user }) => {
    // The rules (unknown code, self-referral, reciprocal farming, already
    // applied) live in the service and raise typed GatewayErrors, so there is
    // nothing to translate here.
    await referrals.applyReferralCode(user, code);
    return { ok: true as const };
  },
});
