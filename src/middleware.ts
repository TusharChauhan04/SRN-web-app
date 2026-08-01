import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie";

/**
 * Cheap, first-pass route protection.
 *
 * IMPORTANT: this only checks that a session cookie EXISTS. It cannot verify
 * it — the Firebase Admin SDK needs Node APIs that the Edge runtime doesn't
 * provide. Real verification (and the role check) happens server-side in the
 * layouts and in `requireUser` / `requireRole` on every Route Handler.
 *
 * So this is a redirect optimisation, not a security boundary. Do not add
 * role logic here on the assumption that it enforces anything.
 */
const PUBLIC_PATHS = ["/login", "/onboarding"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = req.cookies.has(SESSION_COOKIE_NAME);

  if (!hasCookie && !PUBLIC_PATHS.includes(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were headed so sign-in can return them there.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - /api/*      (handlers do their own auth and must return JSON, not a redirect)
     *  - static assets and image optimisation
     *  - the favicon and other public files
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
