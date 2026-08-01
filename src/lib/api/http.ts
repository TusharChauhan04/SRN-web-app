import "server-only";

/**
 * Shared helpers for Route Handlers: consistent JSON envelopes, error mapping,
 * and rate limiting. Every mutating handler should go through `handle()` so a
 * thrown auth error becomes a 401/403 instead of a 500 stack trace.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/session";
import { repo } from "@/lib/repositories";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function error(message: string, status: number, extra?: unknown) {
  return NextResponse.json({ error: message, details: extra }, { status });
}

/**
 * Wraps a handler body, mapping known error types to status codes.
 *
 * Unknown errors deliberately return a generic message: internal details
 * (SQL text, file paths) must not reach the client.
 */
export async function handle<T>(
  fn: () => Promise<T>,
): Promise<NextResponse> {
  try {
    const result = await fn();
    if (result instanceof NextResponse) return result;
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return error(err.message, 401);
    }
    if (err instanceof ForbiddenError) {
      // Log the detail, return a flat message — the specific message names
      // which role gates the route, which is free reconnaissance.
      console.warn("[api] forbidden:", err.message);
      return error("Not allowed", 403);
    }
    if (err instanceof ZodError) {
      return error("Validation failed", 422, err.issues);
    }
    console.error("[api]", err);
    return error("Internal server error", 500);
  }
}

/** Rate limit tiers, adapted from the mobile backend's dual-layer approach. */
export const RATE_LIMITS = {
  /** Sign-in / session exchange — tight, this is the credential path. */
  auth: { limit: 10, windowMs: 60_000 },
  /** Ordinary writes (post a requirement, submit a quote). */
  write: { limit: 60, windowMs: 60_000 },
  /** Chat send — chattier by nature. */
  message: { limit: 120, windowMs: 60_000 },
  /** Payment order creation — very tight, this creates real orders. */
  payment: { limit: 5, windowMs: 60_000 },
  /** Reads. */
  read: { limit: 300, windowMs: 60_000 },
} as const;

export type RateLimitTier = keyof typeof RATE_LIMITS;

/**
 * Number of trusted reverse proxies in front of the app.
 *
 * `X-Forwarded-For` is APPENDED to by each hop, so the rightmost entries are
 * the ones added by infrastructure you control and the leftmost are whatever
 * the client claimed. Taking `[0]` — the previous behaviour — lets an attacker
 * mint a fresh rate-limit bucket per request just by sending the header.
 *
 * Vercel and most managed platforms sit one proxy deep, hence the default.
 */
const TRUSTED_PROXY_COUNT = Number(process.env.TRUSTED_PROXY_COUNT ?? 1);

/** Extracts the client IP without trusting client-supplied XFF entries. */
export function clientIp(req: Request): string | null {
  // Platform-set single-value headers are not client-appendable when the proxy
  // overwrites them, so prefer these.
  const direct =
    req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip");
  if (direct?.trim()) return direct.trim();

  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) return null;

  const hops = forwarded
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length === 0) return null;

  // Count in from the right by the number of proxies we trust.
  const index = hops.length - TRUSTED_PROXY_COUNT;
  return hops[Math.max(0, index)] ?? null;
}

/**
 * Client identity for rate limiting. Prefers the authenticated uid; falls back
 * to the trusted client IP for unauthenticated paths like sign-in.
 *
 * When no IP can be determined the key falls back to a coarse fingerprint
 * rather than a single shared `unknown` bucket — a shared bucket would let one
 * caller exhaust the auth tier and lock out sign-in for everybody.
 */
export function clientKey(req: Request, uid?: string): string {
  if (uid) return `uid:${uid}`;

  const ip = clientIp(req);
  if (ip) return `ip:${ip}`;

  const fingerprint = [
    req.headers.get("user-agent") ?? "",
    req.headers.get("accept-language") ?? "",
  ].join("|");
  return `fp:${fingerprint.slice(0, 120)}`;
}

/**
 * Rejects cross-origin state-changing requests.
 *
 * Next.js applies an origin check to Server Actions automatically, but NOT to
 * Route Handlers — so every mutating handler needs this explicitly. Without it,
 * an attacker can POST their own Firebase ID token to /api/auth/session from
 * another site and silently sign the victim into the attacker's account (login
 * CSRF / session fixation), after which the victim's KYC documents and payment
 * details land in an account the attacker controls.
 */
export function checkOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");

  // Same-origin fetches from a modern browser send this. Non-browser clients
  // (curl, server-to-server) send no Origin at all, which we allow — the
  // endpoint still requires a valid credential.
  if (!origin) return null;

  const allowed = process.env.NEXT_PUBLIC_APP_URL;
  if (!allowed) {
    // Fail closed rather than silently accepting any origin in production.
    if (process.env.NODE_ENV === "production") {
      console.error("[api] NEXT_PUBLIC_APP_URL is not set; rejecting request");
      return error("Origin not allowed", 403);
    }
    return null;
  }

  try {
    if (new URL(origin).origin !== new URL(allowed).origin) {
      return error("Origin not allowed", 403);
    }
  } catch {
    return error("Origin not allowed", 403);
  }

  return null;
}

/** Rejects bodies that aren't declared JSON, closing the simple-request hole. */
export function requireJsonContentType(req: Request): NextResponse | null {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return error("Expected Content-Type: application/json", 415);
  }
  return null;
}

/**
 * Applies a rate limit. Returns a 429 response when exceeded, or null to
 * continue.
 *
 * NOTE: backed by the placeholder database, so it shares that store's
 * limitations — it is per-instance-consistent but not a substitute for an
 * edge/Redis limiter under real load. Flagged in DATABASE.md.
 */
export async function rateLimit(
  req: Request,
  tier: RateLimitTier,
  uid?: string,
): Promise<NextResponse | null> {
  const { limit, windowMs } = RATE_LIMITS[tier];
  const key = `${tier}:${clientKey(req, uid)}`;

  const result = await repo.rateLimit.hit(key, limit, windowMs);
  if (result.allowed) return null;

  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(
          Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)),
        ),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}

/** Parses `?limit=&offset=` with the repository layer's clamping applied. */
export function pageParamsFrom(url: URL): { limit?: number; offset?: number } {
  const limit = url.searchParams.get("limit");
  const offset = url.searchParams.get("offset");
  return {
    ...(limit && { limit: Number(limit) }),
    ...(offset && { offset: Number(offset) }),
  };
}
