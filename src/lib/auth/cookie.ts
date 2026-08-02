/**
 * Session cookie constants.
 *
 * Deliberately in their own module with NO imports.
 *
 * Originally this was a hard requirement: `middleware.ts` ran on the Edge
 * runtime and pulling in `firebase-admin` through a shared module crashed every
 * matched route with a 500. Next 16's `proxy.ts` runs on Node, so that is no
 * longer a crash — but keeping this module dependency-free is still right. It
 * means the one constant shared between the request filter and the auth layer
 * drags nothing along with it.
 */
export const SESSION_COOKIE_NAME = "srn_session";

/** Firebase caps session cookies at 14 days. */
export const SESSION_COOKIE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
