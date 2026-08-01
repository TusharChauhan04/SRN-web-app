/**
 * Session exchange.
 *
 * POST — trade a Firebase ID token for an httpOnly session cookie.
 * DELETE — sign out, clearing the cookie and revoking refresh tokens.
 *
 * This replaces mobile's AsyncStorage token persistence. The cookie is httpOnly
 * so page JavaScript cannot read it, which is the main reason to prefer it over
 * localStorage on web.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_COOKIE_NAME,
  adminAuth,
  createSessionCookie,
} from "@/lib/firebase/admin";
import {
  checkOrigin,
  error,
  handle,
  rateLimit,
  requireJsonContentType,
} from "@/lib/api/http";

const bodySchema = z.object({ idToken: z.string().min(1) });

export async function POST(req: Request) {
  // Origin check BEFORE anything else: Next.js protects Server Actions from
  // cross-origin POSTs but not Route Handlers, and this endpoint mints a
  // session. Without it, an attacker can log a victim into the attacker's
  // account from another site.
  const badOrigin = checkOrigin(req);
  if (badOrigin) return badOrigin;

  const badContentType = requireJsonContentType(req);
  if (badContentType) return badContentType;

  const limited = await rateLimit(req, "auth");
  if (limited) return limited;

  return handle(async () => {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return error("idToken is required", 400);

    // verifyIdToken first: createSessionCookie alone would accept a token from
    // a different Firebase project.
    const decoded = await adminAuth()
      .verifyIdToken(parsed.data.idToken, true)
      .catch(() => null);
    if (!decoded) return error("Invalid ID token", 401);

    // Password sign-ups must prove they control the address before it becomes
    // the profile's canonical email — this marketplace attaches KYC documents
    // and payouts to it. Federated providers (Google) assert this themselves.
    const isPasswordProvider = decoded.firebase?.sign_in_provider === "password";
    if (isPasswordProvider && !decoded.email_verified) {
      return error(
        "Verify your email address before signing in. Check your inbox for the verification link.",
        403,
      );
    }

    const cookie = await createSessionCookie(parsed.data.idToken);

    const res = NextResponse.json({ uid: decoded.uid });
    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: cookie,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_MS / 1000,
    });
    return res;
  });
}

export async function DELETE(req: Request) {
  const badOrigin = checkOrigin(req);
  if (badOrigin) return badOrigin;

  // Each sign-out costs a verify plus a revoke against Firebase, so it needs a
  // limit of its own.
  const limited = await rateLimit(req, "auth");
  if (limited) return limited;

  return handle(async () => {
    const cookieEntry = req.headers
      .get("cookie")
      ?.split(";")
      .find((c) => c.trim().startsWith(`${SESSION_COOKIE_NAME}=`));

    // slice past the FIRST "=", not split on every one — a value containing
    // "=" would otherwise be truncated, leaving uid null so nothing gets
    // revoked while the endpoint still returns {ok:true}. Exactly the silent
    // failure the rest of this handler exists to prevent.
    const cookieValue = cookieEntry
      ? cookieEntry.trim().slice(cookieEntry.trim().indexOf("=") + 1)
      : undefined;

    if (cookieValue) {
      // Distinguish "cookie was already invalid" from "revocation failed".
      // Swallowing both meant a transient Firebase error returned {ok:true}
      // while the session stayed valid for its full 5-day life — and sign-out
      // is exactly the action a user takes when they think it's compromised.
      let uid: string | null = null;
      try {
        const decoded = await adminAuth().verifySessionCookie(cookieValue);
        uid = decoded.sub;
      } catch {
        // Expired/invalid/forged cookie: nothing to revoke, clearing is right.
      }

      if (uid) {
        try {
          await adminAuth().revokeRefreshTokens(uid);
        } catch (err) {
          console.error("[api] sign-out revocation failed", err);
          return error(
            "Could not fully sign you out. Please try again.",
            503,
          );
        }
      }
    }

    const res = NextResponse.json({ ok: true });
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
  });
}
