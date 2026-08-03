import "server-only";

/**
 * Auth policy.
 *
 * Services own POLICY — who may do what, and what a successful action implies.
 * Repositories own INVARIANTS — keeping the data consistent with itself.
 * Providers own INTEGRATION — talking to Firebase, Razorpay, storage.
 *
 * Nothing here knows that the identity provider is Firebase.
 */
import { authProvider } from "@/lib/providers/auth/index.server";
import { repo } from "@/lib/repositories";
import { SYSTEM_ACTOR } from "@/lib/repositories/authorize";
import type { SelfSelectableRole, User } from "@/lib/repositories/types";
import { GatewayError } from "@/lib/gateway/types";

export interface CreatedSession {
  cookieValue: string;
  maxAgeMs: number;
  uid: string;
  /** True when the caller still needs to complete onboarding. */
  needsOnboarding: boolean;
}

/**
 * Verifies a client credential and mints a session.
 *
 * Two things happen here that must not move elsewhere:
 *  - the credential is VERIFIED before a session is created, so a credential
 *    from another project (or a forged one) is rejected;
 *  - password sign-ups must have a confirmed email, because that address
 *    becomes the identity KYC documents and payouts attach to.
 */
export async function createSession(credential: string): Promise<CreatedSession> {
  const provider = authProvider();

  const identity = await provider.verifyCredential(credential);
  if (!identity) {
    throw GatewayError.unauthenticated("That sign-in could not be verified.");
  }

  if (identity.signInProvider === "password" && !identity.emailVerified) {
    throw GatewayError.forbidden(
      "Verify your email address first — check your inbox for the link.",
    );
  }

  const existing = await repo.users.findById(identity.uid);
  if (existing?.isSuspended) {
    // Same message as an unknown account: confirming a suspension to whoever
    // holds the credential is not useful to us.
    throw GatewayError.forbidden("This account is not available.");
  }

  const session = await provider.createSession(credential);

  return {
    cookieValue: session.value,
    maxAgeMs: session.maxAgeMs,
    uid: identity.uid,
    needsOnboarding: existing === null,
  };
}

/**
 * Ends a session everywhere.
 *
 * Deliberately throws when revocation fails rather than reporting success:
 * signing out is what people do when they believe an account is compromised, so
 * a false "signed out" is the worst possible answer.
 *
 * Takes a UID, not a cookie value. It used to take the cookie, and the ONLY
 * caller — the browser — passed null every time, because the cookie is
 * httpOnly and JavaScript structurally cannot read it. So the function returned
 * on its first line, forever. The route cleared the browser cookie, which made
 * sign-out look like it worked, while the session stayed valid at the provider
 * for its full lifetime. Anyone holding a copy of that cookie kept full access
 * after the user believed they had signed out.
 *
 * The gateway has already verified the session and resolved the uid, so the
 * caller passes that instead — a value the browser cannot forge or omit.
 */
export async function destroySession(uid: string | null): Promise<void> {
  // Already signed out: clearing the cookie is the whole job.
  if (!uid) return;

  const provider = authProvider();

  try {
    await provider.revokeSessions(uid);
  } catch (err) {
    console.error("[auth.service] revocation failed", err);
    throw new GatewayError(
      "provider_error",
      "We couldn't fully sign you out. Please try again.",
    );
  }
}

export interface CompleteOnboardingInput {
  role: SelfSelectableRole;
  name: string;
  location?: string;
  title?: string;
  skills?: string[];
  companyName?: string;
  industry?: string;
  referralCode?: string;
}

/** Creates the profile row for a verified identity that has none yet. */
export async function completeOnboarding(
  uid: string,
  email: string | null,
  input: CompleteOnboardingInput,
): Promise<User> {
  if (!email) {
    throw GatewayError.validation(
      "Your account has no email address attached.",
    );
  }

  // Guards the race where two submissions land before the first redirect.
  const existing = await repo.users.findById(uid);
  if (existing) return existing;

  const user = await repo.users.create({
    id: uid,
    email,
    name: input.name,
    // The role is already narrowed to a self-selectable one by the operation's
    // Zod schema; admin is never reachable here.
    role: input.role,
    location: input.location,
    title: input.title,
    skills: input.skills,
    companyName: input.companyName,
    industry: input.industry,
  });

  if (input.referralCode) {
    // Best effort: a bad or already-used code must not block onboarding.
    // Goes through the service so the anti-fraud rules apply here too —
    // signup is exactly where someone would try to farm referrals.
    const { applyReferralCode } = await import("./referrals.service");
    await applyReferralCode(user, input.referralCode).catch(() => {});
  }

  // Audited here rather than in the gateway: the service is what holds the
  // typed result and knows which fields are worth recording.
  await repo.audit
    .record({
      actorId: user.id,
      action: "user.onboarded",
      target: user.id,
      metadata: { role: user.role },
    })
    .catch((err) => {
      // Never fail onboarding because its audit write failed.
      console.error("[auth.service] audit write failed", err);
    });

  return user;
}

/**
 * Invalidates every outstanding session for a user.
 *
 * Used when an account is suspended, so the credential stops working at the
 * provider rather than relying solely on our own database check.
 */
export async function revokeUserSessions(uid: string): Promise<void> {
  await authProvider().revokeSessions(uid);
}

/** Deletes the identity record. Used by GDPR erasure, after data anonymisation. */
export async function deleteIdentity(uid: string): Promise<void> {
  await authProvider().deleteIdentity(uid);
  await repo.audit.record({
    actorId: undefined,
    action: "identity.deleted",
    target: uid,
  });
}

/** Exposed for /api/healthz. */
export function authProviderStatus(): { name: string; configured: boolean } {
  const provider = authProvider();
  return { name: provider.name, configured: provider.isConfigured };
}

export { SYSTEM_ACTOR };
