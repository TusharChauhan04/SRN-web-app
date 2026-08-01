import "server-only";

import { z } from "zod";
import { defineOperation } from "../core";
import * as svc from "@/lib/services/requirements.service";

const page = {
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
};

const requirementStatus = z.enum([
  "open",
  "in_progress",
  "closed",
  "cancelled",
]);

export const create = defineOperation({
  name: "requirements.create",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    title: z.string().trim().min(8, "Give it a clearer title").max(140),
    category: z.string().trim().min(2).max(60),
    description: z.string().trim().min(30, "Add a bit more detail").max(5000),
    skillsNeeded: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    // Bounded so a typo can't create a ₹10,000,000,000 requirement.
    minBudget: z.number().min(0).max(100_000_000),
    maxBudget: z.number().min(0).max(100_000_000),
    location: z.string().trim().max(120).optional(),
  }),
  handler: (input, { user }) => svc.createRequirement(user, input),
});

export const listMine = defineOperation({
  name: "requirements.listMine",
  kind: "query",
  access: "authenticated",
  input: z.object({ status: requirementStatus.optional(), ...page }),
  handler: (input, { user }) => svc.listMine(user, input),
});

/** The skill-matched feed a provider sees. */
export const feed = defineOperation({
  name: "requirements.feed",
  kind: "query",
  access: "authenticated",
  input: z.object(page),
  handler: (input, { user }) => svc.listOpenForProvider(user, input),
});

export const browse = defineOperation({
  name: "requirements.browse",
  kind: "query",
  access: "authenticated",
  input: z.object({
    query: z.string().trim().max(120).optional(),
    category: z.string().trim().max(60).optional(),
    skills: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    minBudget: z.number().min(0).optional(),
    maxBudget: z.number().min(0).optional(),
    ...page,
  }),
  handler: (input) => svc.listOpen(input),
});

export const detail = defineOperation({
  name: "requirements.detail",
  kind: "query",
  access: "authenticated",
  input: z.object({ id: z.string().min(1) }),
  handler: ({ id }, { user }) => svc.getRequirementDetail(user, id),
});

export const setStatus = defineOperation({
  name: "requirements.setStatus",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ id: z.string().min(1), status: requirementStatus }),
  handler: ({ id, status }, { user }) =>
    svc.updateRequirementStatus(user, id, status),
});

export const remove = defineOperation({
  name: "requirements.delete",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ id: z.string().min(1) }),
  handler: async ({ id }, { user }) => {
    await svc.deleteRequirement(user, id);
    return { ok: true as const };
  },
});

// ─────────────────────────── Quotes ───────────────────────────

export const submitQuote = defineOperation({
  name: "quotes.submit",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    requirementId: z.string().min(1),
    amount: z.number().min(1).max(100_000_000),
    durationDays: z.number().int().min(1).max(365),
    message: z.string().trim().max(2000).optional(),
  }),
  handler: (input, { user }) => svc.submitQuote(user, input),
});

export const listMyQuotes = defineOperation({
  name: "quotes.listMine",
  kind: "query",
  access: "authenticated",
  input: z.object(page),
  handler: (input, { user }) => svc.listMyQuotes(user, input),
});

export const quoteDetail = defineOperation({
  name: "quotes.detail",
  kind: "query",
  access: "authenticated",
  input: z.object({ id: z.string().min(1) }),
  handler: ({ id }, { user }) => svc.getQuote(user, id),
});

export const shortlistQuote = defineOperation({
  name: "quotes.shortlist",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ id: z.string().min(1) }),
  handler: ({ id }, { user }) => svc.shortlistQuote(user, id),
});

export const rejectQuote = defineOperation({
  name: "quotes.reject",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ id: z.string().min(1) }),
  handler: ({ id }, { user }) => svc.rejectQuote(user, id),
});

export const withdrawQuote = defineOperation({
  name: "quotes.withdraw",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ id: z.string().min(1) }),
  handler: ({ id }, { user }) => svc.withdrawQuote(user, id),
});
