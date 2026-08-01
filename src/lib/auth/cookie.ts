/**
 * Session cookie constants.
 *
 * Deliberately in their own module with NO imports: `middleware.ts` runs on the
 * Edge runtime and needs the cookie name, but must not pull in `firebase-admin`
 * (Node-only) as a side effect. Importing these from lib/firebase/admin.ts
 * crashes every middleware-matched route with a 500.
 */
export const SESSION_COOKIE_NAME = "srn_session";

/** Firebase caps session cookies at 14 days. */
export const SESSION_COOKIE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
