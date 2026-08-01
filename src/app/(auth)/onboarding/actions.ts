"use server";

/**
 * Onboarding submission.
 *
 * A Server Action rather than a client fetch, because it is a form post with no
 * other consumer — but it still goes through the gateway rather than touching
 * repositories, so validation, rate limiting, access policy and the audit entry
 * all apply exactly as they would over HTTP.
 */
import { redirect } from "next/navigation";
import { gateway, GatewayError } from "@/lib/gateway";
import { homeForRole } from "@/lib/nav/config";
import type { SelfSelectableRole } from "@/lib/repositories/types";

export type OnboardingState = { error?: string };

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const raw = Object.fromEntries(formData) as Record<string, string>;

  let destination: string;
  try {
    const user = await gateway.auth.completeOnboarding({
      role: raw.role as SelfSelectableRole,
      name: raw.name ?? "",
      location: raw.location || undefined,
      title: raw.title || undefined,
      // Split here so the gateway schema can validate real array bounds rather
      // than a comma-separated blob.
      skills: raw.skills
        ? raw.skills.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      companyName: raw.companyName || undefined,
      industry: raw.industry || undefined,
      referralCode: raw.referralCode || undefined,
    });
    destination = homeForRole(user.role);
  } catch (err) {
    if (err instanceof GatewayError) {
      return { error: err.message };
    }
    throw err;
  }

  // Outside the try: redirect() throws by design, and catching it here would
  // turn a successful signup into an error message.
  redirect(destination);
}
