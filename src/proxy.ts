import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie";

/**
 * Pre-render redirect for signed-out visitors. Next 16's `proxy` convention,
 * which replaces the deprecated `middleware` file.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS NOT A SECURITY BOUNDARY, AND IT MUST NOT BECOME ONE.
 *
 * The durable reason is COVERAGE, not runtime: the matcher below deliberately
 * excludes `/api/*`, so this file never runs for a single gateway route. Any
 * check added here is therefore enforced on exactly the routes that carry no
 * data, and absent from every route that does. It would be security theatre.
 *
 * It also only checks that a session cookie EXISTS — it does not verify one. A
 * forged or expired cookie gets past this file and is then rejected by the
 * gateway. That is the design working, not a gap.
 *
 * Real enforcement lives in two places, both server-side and both covering the
 * API surface this file cannot see:
 *   - `assertAccess` in src/lib/gateway/core.ts, on every operation
 *   - the authenticated layouts, (app)/layout.tsx and (app)/admin/layout.tsx
 *
 * Delete this file entirely and the security posture is unchanged; you lose
 * only the wasted render of a page that would immediately bounce.
 *
 * NOTE: unlike the old middleware convention, a proxy file runs on the Node.js
 * runtime. Node APIs are therefore *available* here — which removes the
 * accidental guardrail that used to make the rule above self-enforcing. An
 * ESLint block in eslint.config.mjs now restricts what this file may import;
 * that is what keeps the rule honest.
 * ─────────────────────────────────────────────────────────────────────────
 */
const PUBLIC_PATHS = ["/login", "/onboarding"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasCookie = req.cookies.has(SESSION_COOKIE_NAME);

  if (!hasCookie && !PUBLIC_PATHS.includes(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // Preserve the destination so sign-in can return them to it.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything EXCEPT:
     *  - /api/*  — load-bearing. The gateway must answer with a JSON error
     *              envelope, never a 307 to /login. A fetch() that follows a
     *              redirect and gets an HTML login page instead of
     *              {error:{code:"unauthenticated"}} breaks every client call.
     *  - static assets and image optimisation
     *  - favicon and other public files
     *
     * The lookahead is anchored right after the leading slash, so this
     * over-excludes (a hypothetical /apitest would skip too) but can never
     * under-exclude — the safe direction for something guarding the API.
     *
     * KNOWN GAP: a future robots.ts, sitemap.ts or /.well-known/* route would
     * be matched and redirected to /login for anonymous callers, including
     * crawlers. None exist today; add them to the exclusion when one does.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
