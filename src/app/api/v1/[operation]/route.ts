/**
 * HTTP face of the gateway.
 *
 * One handler dispatches every operation, so throttling, validation, access
 * policy and error shaping cannot be implemented differently per endpoint —
 * there is only one implementation, in `invoke`.
 *
 * POST /api/v1/:operation   body: { input?: unknown }
 *
 * POST for everything, including reads: inputs are structured, and a GET with a
 * JSON body is not a thing. Queries are still marked `kind: "query"` internally
 * so they get read-tier limits.
 */
import { NextResponse } from "next/server";
import {
  GatewayError,
  getOperation,
  invoke,
  loadOperations,
} from "@/lib/gateway";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_MS,
} from "@/lib/auth/cookie";

// Populates the operation registry.
loadOperations();

export const dynamic = "force-dynamic";

/**
 * Rejects cross-origin state-changing requests.
 *
 * Next.js applies an origin check to Server Actions but NOT to Route Handlers,
 * so it has to be explicit here. Without it, an attacker could POST their own
 * credential to auth.createSession from another site and silently sign a victim
 * into the attacker's account.
 */
function checkOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  // Absent Origin means a non-browser client; the operation's own access policy
  // still applies.
  if (!origin) return null;

  const allowed = process.env.NEXT_PUBLIC_APP_URL;
  if (!allowed) {
    if (process.env.NODE_ENV === "production") {
      console.error("[api/v1] NEXT_PUBLIC_APP_URL unset; rejecting request");
      return errorResponse(new GatewayError("forbidden", "Origin not allowed"));
    }
    return null;
  }

  try {
    if (new URL(origin).origin !== new URL(allowed).origin) {
      return errorResponse(new GatewayError("forbidden", "Origin not allowed"));
    }
  } catch {
    return errorResponse(new GatewayError("forbidden", "Origin not allowed"));
  }
  return null;
}

function errorResponse(err: GatewayError): NextResponse {
  return NextResponse.json(
    { error: { code: err.code, message: err.message, details: err.details } },
    {
      status: err.status,
      ...(err.code === "rate_limited" && {
        headers: {
          "Retry-After": String(
            (err.details as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 60,
          ),
        },
      }),
    },
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ operation: string }> },
) {
  const badOrigin = checkOrigin(req);
  if (badOrigin) return badOrigin;

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse(
      new GatewayError("validation_failed", "Expected application/json"),
    );
  }

  const { operation } = await params;
  const def = getOperation(operation);
  if (!def) {
    return errorResponse(new GatewayError("not_found", "Unknown operation"));
  }

  let body: { input?: unknown };
  try {
    body = (await req.json()) as { input?: unknown };
  } catch {
    return errorResponse(new GatewayError("validation_failed", "Malformed JSON"));
  }

  try {
    const result = await invoke(def, body.input);

    // Session operations are the one place the gateway's result has to become
    // an HTTP cookie, because only the transport can set one.
    if (operation === "auth.createSession") {
      const session = result as { cookieValue: string; maxAgeMs: number };
      const res = NextResponse.json({
        data: { ...(result as object), cookieValue: undefined },
      });
      res.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: session.cookieValue,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: (session.maxAgeMs ?? SESSION_COOKIE_MAX_AGE_MS) / 1000,
      });
      return res;
    }

    if (operation === "auth.destroySession") {
      const res = NextResponse.json({ data: result });
      res.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: "",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
      return res;
    }

    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof GatewayError) return errorResponse(err);
    // invoke() already normalises handler failures; anything here is a bug in
    // the dispatch layer itself.
    console.error("[api/v1] dispatch failure:", err);
    return errorResponse(new GatewayError("internal", "Something went wrong"));
  }
}
