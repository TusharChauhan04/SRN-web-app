import "server-only";

/**
 * Server-side session resolution and role gating.
 *
 * The mobile app checked `profile.role === "admin"` on the client because the
 * Express API was the real gate. On web the Route Handlers ARE the API, so the
 * role check has to happen here, on the server, on every protected call. A
 * client-side check alone would be decorative.
 */
import { cookies } from "next/headers";
import { cache } from "react";
import { SESSION_COOKIE_NAME, verifySessionCookie } from "@/lib/firebase/admin";
import { repo } from "@/lib/repositories";
import type { User, UserRole } from "@/lib/repositories/types";

export interface Session {
  uid: string;
  email: string | null;
  /** Null when the account is authenticated but has not completed onboarding. */
  user: User | null;
}

/**
 * Resolves the current session, or null when signed out.
 *
 * Wrapped in React `cache` so multiple calls within one request (layout, page,
 * and a handful of components) share a single verification round trip.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;

  try {
    const decoded = await verifySessionCookie(cookie);
    const user = await repo.users.findById(decoded.uid);

    // A suspended account is treated as signed out everywhere, so no screen has
    // to remember to check the flag individually.
    if (user?.isSuspended) return null;

    return { uid: decoded.uid, email: decoded.email ?? null, user };
  } catch {
    // Expired, revoked, or malformed cookie — all mean "signed out".
    return null;
  }
});

/** The onboarded user, or null if signed out / not yet onboarded. */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  return session?.user ?? null;
}

export class UnauthorizedError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Not allowed") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Throws unless a fully onboarded user is signed in. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Throws unless the signed-in user holds one of `roles`. */
export async function requireRole(...roles: UserRole[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new ForbiddenError(
      `Requires role: ${roles.join(" or ")}; user is ${user.role}`,
    );
  }
  return user;
}

/** Convenience wrapper for the admin-only surface. */
export async function requireAdmin(): Promise<User> {
  return requireRole("admin");
}
