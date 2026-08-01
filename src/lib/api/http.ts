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
      return error(err.message, 403);
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
 * Best-effort client identity for rate limiting. Prefers the authenticated uid;
 * falls back to the forwarded IP for unauthenticated paths like sign-in.
 */
export function clientKey(req: Request, uid?: string): string {
  if (uid) return `uid:${uid}`;
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  return `ip:${ip}`;
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
