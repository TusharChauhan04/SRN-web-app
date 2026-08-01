import "server-only";

/**
 * Session helpers for layouts and pages.
 *
 * These are a thin read-only view over the gateway's request context. They
 * exist so a layout can decide what to render without making a data call —
 * they do NOT grant access to anything. Actual data still goes through the
 * gateway, which applies its own access policy per operation.
 */
import { getContext } from "@/lib/gateway/context";
import type { User, UserRole } from "@/lib/repositories/types";

export interface Session {
  uid: string;
  email: string | null;
  /** Null when authenticated but onboarding is not finished. */
  user: User | null;
}

/** The current session, or null when signed out. */
export async function getSession(): Promise<Session | null> {
  const ctx = await getContext();
  if (!ctx.uid) return null;
  return { uid: ctx.uid, email: ctx.email, user: ctx.user };
}

/** The onboarded user, or null if signed out / not yet onboarded. */
export async function getCurrentUser(): Promise<User | null> {
  return (await getContext()).user;
}

/** True when the signed-in user holds one of `roles`. For rendering choices. */
export async function hasRole(...roles: UserRole[]): Promise<boolean> {
  const user = await getCurrentUser();
  return user ? roles.includes(user.role) : false;
}
