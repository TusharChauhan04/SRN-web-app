import "server-only";

/**
 * Firebase Auth server provider — the intended production identity backend.
 *
 * This is the ONLY server file allowed to import `firebase-admin`. Everything
 * else speaks `AuthServerProvider`, so this file is the entire surface that
 * changes if the identity provider is ever swapped.
 *
 * To connect it: set AUTH_PROVIDER=firebase plus FIREBASE_PROJECT_ID,
 * FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY. Nothing else moves.
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { SESSION_COOKIE_MAX_AGE_MS } from "@/lib/auth/cookie";
import type {
  AuthServerProvider,
  SessionCookie,
  VerifiedIdentity,
} from "./types";

const ADMIN_APP_NAME = "srn-admin";

export const isFirebaseAdminConfigured = Boolean(
  process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY,
);

function adminApp(): App {
  const existing = getApps().find((a) => a.name === ADMIN_APP_NAME);
  if (existing) return existing;

  if (!isFirebaseAdminConfigured) {
    throw new Error(
      "Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, " +
        "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or run with " +
        "AUTH_PROVIDER=mock for local development.",
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

function auth(): Auth {
  return getAuth(adminApp());
}

export class FirebaseAuthServerProvider implements AuthServerProvider {
  readonly name = "firebase";

  get isConfigured(): boolean {
    return isFirebaseAdminConfigured;
  }

  async verifyCredential(credential: string): Promise<VerifiedIdentity | null> {
    try {
      // checkRevoked: a signed-out or disabled account must stop working
      // immediately, not at token expiry.
      const decoded = await auth().verifyIdToken(credential, true);
      return {
        uid: decoded.uid,
        email: decoded.email ?? null,
        emailVerified: Boolean(decoded.email_verified),
        signInProvider: decoded.firebase?.sign_in_provider ?? null,
      };
    } catch {
      // Fail closed — expired, revoked, malformed, or from another project.
      return null;
    }
  }

  async createSession(credential: string): Promise<SessionCookie> {
    // Caller is expected to have verified first; createSessionCookie alone
    // would accept a token minted by a different Firebase project.
    const value = await auth().createSessionCookie(credential, {
      expiresIn: SESSION_COOKIE_MAX_AGE_MS,
    });
    return { value, maxAgeMs: SESSION_COOKIE_MAX_AGE_MS };
  }

  async verifySession(cookieValue: string): Promise<VerifiedIdentity | null> {
    try {
      const decoded = await auth().verifySessionCookie(cookieValue, true);
      return {
        uid: decoded.uid,
        email: decoded.email ?? null,
        emailVerified: Boolean(decoded.email_verified),
        signInProvider: decoded.firebase?.sign_in_provider ?? null,
      };
    } catch {
      return null;
    }
  }

  async revokeSessions(uid: string): Promise<void> {
    // Deliberately unguarded: the caller must surface a failure rather than
    // reporting a successful sign-out that didn't happen.
    await auth().revokeRefreshTokens(uid);
  }

  async deleteIdentity(uid: string): Promise<void> {
    await auth().deleteUser(uid);
  }
}
