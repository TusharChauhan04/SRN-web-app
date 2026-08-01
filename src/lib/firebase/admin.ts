import "server-only";

/**
 * Firebase Admin SDK — server-side token verification and session cookies.
 *
 * This is the trust boundary. A Firebase ID token from the browser is only
 * believed after `verifyIdToken` succeeds here; the user's ROLE is never read
 * from the token, only from our own database (see src/lib/auth/session.ts).
 */
import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { SESSION_COOKIE_MAX_AGE_MS } from "@/lib/auth/cookie";

const ADMIN_APP_NAME = "srn-admin";

export const isAdminConfigured = Boolean(
  process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY,
);

function getAdminApp(): App {
  const existing = getApps().find((a) => a.name === ADMIN_APP_NAME);
  if (existing) return existing;

  if (!isAdminConfigured) {
    throw new Error(
      "Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.",
    );
  }

  return initializeApp(
    {
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Env vars keep literal "\n"; the SDK needs real newlines.
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    },
    ADMIN_APP_NAME,
  );
}

export function adminAuth(): Auth {
  return getAuth(getAdminApp());
}

// Re-exported for convenience; the canonical definitions live in
// lib/auth/cookie.ts so the Edge middleware can read them without importing
// firebase-admin.
export {
  SESSION_COOKIE_MAX_AGE_MS,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/cookie";

/** Exchanges a freshly-minted ID token for a long-lived session cookie. */
export async function createSessionCookie(idToken: string): Promise<string> {
  return adminAuth().createSessionCookie(idToken, {
    expiresIn: SESSION_COOKIE_MAX_AGE_MS,
  });
}

/**
 * Verifies a session cookie. `checkRevoked` costs a round trip but means a
 * signed-out or disabled account stops working immediately rather than at
 * cookie expiry.
 */
export async function verifySessionCookie(cookie: string) {
  return adminAuth().verifySessionCookie(cookie, true);
}
