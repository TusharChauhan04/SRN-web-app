"use server";

/**
 * Profile creation — the web equivalent of mobile's OnboardingScreen calling
 * POST /api/users.
 *
 * A Server Action rather than a Route Handler: this is a form submission with
 * no other consumer, and it needs the session cookie anyway.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { homeForRole } from "@/lib/nav/config";
import { repo } from "@/lib/repositories";
import { SELF_SELECTABLE_ROLES } from "@/lib/repositories/types";

const schema = z.object({
  // Allowlist from types.ts — admin is granted, never self-selected. Using the
  // shared constant means a newly added privileged role is not self-assignable
  // by default.
  role: z.enum(SELF_SELECTABLE_ROLES),
  name: z.string().trim().min(2, "Enter your name").max(80),
  location: z.string().trim().max(120).optional(),
  title: z.string().trim().max(120).optional(),
  skills: z.string().trim().max(400).optional(),
  companyName: z.string().trim().max(120).optional(),
  industry: z.string().trim().max(120).optional(),
  referralCode: z.string().trim().max(20).optional(),
});

export type OnboardingState = { error?: string };

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const session = await getSession();
  if (!session) return { error: "Your session expired. Sign in again." };
  if (session.user) redirect(homeForRole(session.user.role));

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  }

  const input = parsed.data;

  // Guard the race where two submissions land before the first redirect.
  const existing = await repo.users.findById(session.uid);
  if (existing) redirect(homeForRole(existing.role));

  if (!session.email) {
    return { error: "Your account has no email address attached." };
  }

  const user = await repo.users.create({
    id: session.uid,
    email: session.email,
    name: input.name,
    // No cast needed: z.enum(SELF_SELECTABLE_ROLES) already narrows this to a
    // role the user is permitted to self-assign.
    role: input.role,
    location: input.location || undefined,
    title: input.title || undefined,
    skills: input.skills
      ? input.skills.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
    companyName: input.companyName || undefined,
    industry: input.industry || undefined,
  });

  // Referral credit is best-effort: a bad code must not block onboarding.
  if (input.referralCode) {
    await repo.referrals.applyCode(input.referralCode, user.id).catch(() => {});
  }

  await repo.audit.record({
    actorId: user.id,
    action: "user.onboarded",
    target: user.id,
    metadata: { role: user.role },
  });

  redirect(homeForRole(user.role));
}
