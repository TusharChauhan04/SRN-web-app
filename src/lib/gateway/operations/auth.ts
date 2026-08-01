import "server-only";

import { z } from "zod";
import { defineOperation } from "../core";
import { GatewayError } from "../types";
import * as authService from "@/lib/services/auth.service";
import {
  SELF_SELECTABLE_ROLES,
  type User,
} from "@/lib/repositories/types";

/**
 * Exchanges a provider credential for a session.
 *
 * `public` because the caller is by definition not signed in yet, and rate
 * limited on the `auth` tier because it triggers a provider round trip.
 */
export const createSession = defineOperation({
  name: "auth.createSession",
  kind: "mutation",
  access: "public",
  rateTier: "auth",
  input: z.object({ credential: z.string().min(1).max(4096) }),
  handler: async ({ credential }) => authService.createSession(credential),
});

export const destroySession = defineOperation({
  name: "auth.destroySession",
  kind: "mutation",
  access: "public",
  rateTier: "auth",
  input: z.object({ cookieValue: z.string().nullable() }),
  handler: async ({ cookieValue }) => {
    await authService.destroySession(cookieValue);
    return { ok: true as const };
  },
});

/** Profile creation. `onboarding` access: signed in, but no profile row yet. */
export const completeOnboarding = defineOperation({
  name: "auth.completeOnboarding",
  kind: "mutation",
  access: "onboarding",
  rateTier: "write",
  input: z.object({
    // Admin is structurally unreachable — SELF_SELECTABLE_ROLES excludes it and
    // an exhaustiveness check in types.ts fails the build if a new privileged
    // role is added without being classified.
    role: z.enum(SELF_SELECTABLE_ROLES),
    name: z.string().trim().min(2, "Enter your name").max(80),
    location: z.string().trim().max(120).optional(),
    title: z.string().trim().max(120).optional(),
    skills: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    companyName: z.string().trim().max(120).optional(),
    industry: z.string().trim().max(120).optional(),
    referralCode: z.string().trim().max(20).optional(),
  }),
  handler: async (input, { ctx }): Promise<User> => {
    if (!ctx.uid) throw GatewayError.unauthenticated();
    return authService.completeOnboarding(ctx.uid, ctx.email, input);
  },
});

/** The signed-in user's own profile. Never anyone else's. */
export const me = defineOperation({
  name: "auth.me",
  kind: "query",
  access: "authenticated",
  input: z.void(),
  handler: async (_input, { user }): Promise<User> => user,
});
