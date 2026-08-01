import "server-only";

/**
 * Request context resolution for the gateway.
 *
 * Uses `next/headers` rather than a `Request` object so the SAME code serves
 * both transports — an in-process call from a server component and an HTTP call
 * to /api/v1 resolve identity identically. If these diverged, the API and
 * server rendering would enforce different rules.
 */
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie";
import { authProvider } from "@/lib/providers/auth/index.server";
import { repo } from "@/lib/repositories";
import type { User } from "@/lib/repositories/types";

export interface GatewayContext {
  /** Provider-verified identity, or null when signed out. */
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
  /** Our profile row. Null when signed out OR not yet onboarded. */
  user: User | null;
  /** Client IP as far as we trust it. Used for rate limiting and audit. */
  ip: string | null;
  userAgent: string | null;
}

/**
 * Number of reverse proxies in front of the app.
 *
 * `X-Forwarded-For` is appended to by each hop, so the rightmost entries come
 * from infrastructure we control and the leftmost are whatever the client
 * claimed. Reading index 0 would let anyone mint a fresh rate-limit bucket per
 * request. Vercel is one hop deep; change this if you deploy elsewhere.
 */
const TRUSTED_PROXY_COUNT = Number(process.env.TRUSTED_PROXY_COUNT ?? 1);

function clientIpFrom(headerList: Headers): string | null {
  const direct =
    headerList.get("x-vercel-forwarded-for") ?? headerList.get("x-real-ip");
  if (direct?.trim()) return direct.trim();

  const forwarded = headerList.get("x-forwarded-for");
  if (!forwarded) return null;

  const hops = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
  if (hops.length === 0) return null;

  return hops[Math.max(0, hops.length - TRUSTED_PROXY_COUNT)] ?? null;
}

/**
 * Resolves the caller.
 *
 * Wrapped in React `cache` so a page that makes several gateway calls verifies
 * the session once per request rather than once per call.
 */
export const getContext = cache(async (): Promise<GatewayContext> => {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  const base = {
    ip: clientIpFrom(headerList),
    userAgent: headerList.get("user-agent"),
  };

  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    return { uid: null, email: null, emailVerified: false, user: null, ...base };
  }

  const identity = await authProvider().verifySession(cookieValue);
  if (!identity) {
    // Expired, revoked, forged, or from another project — all mean signed out.
    return { uid: null, email: null, emailVerified: false, user: null, ...base };
  }

  const user = await repo.users.findById(identity.uid);

  // A suspended account is treated as signed out everywhere, so no individual
  // screen or operation has to remember to check the flag.
  if (user?.isSuspended) {
    return { uid: null, email: null, emailVerified: false, user: null, ...base };
  }

  return {
    uid: identity.uid,
    email: identity.email,
    emailVerified: identity.emailVerified,
    user,
    ...base,
  };
});
