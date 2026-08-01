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
import { error, handle, rateLimit } from "@/lib/api/http";

const bodySchema = z.object({ idToken: z.string().min(1) });

export async function POST(req: Request) {
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
  return handle(async () => {
    const cookieHeader = req.headers
      .get("cookie")
      ?.split(";")
      .find((c) => c.trim().startsWith(`${SESSION_COOKIE_NAME}=`))
      ?.split("=")[1];

    // Revoke refresh tokens so the session cannot be resurrected from a stale
    // ID token on another device.
    if (cookieHeader) {
      await adminAuth()
        .verifySessionCookie(cookieHeader)
        .then((decoded) => adminAuth().revokeRefreshTokens(decoded.sub))
        .catch(() => {
          // Already invalid — clearing the cookie is still the right outcome.
        });
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
