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


/**
 * Short-lived cache of verified session cookies.
 *
 * `verifySessionCookie(cookie, true)` — the `true` is `checkRevoked` — forces a
 * lookup against Google's Auth backend. That is a NETWORK ROUND TRIP on every
 * gateway call and every server-rendered page, which is latency on everything
 * we serve and a billed API call per request. Measured on the chat screen it
 * was 12 calls per minute per open tab, before any user action.
 *
 * The flag cannot simply be dropped: it is what makes sign-out revocation take
 * effect, and a "signed out" that leaves the session working is the worst
 * possible answer. So the RESULT is cached instead, briefly.
 *
 * The trade, stated precisely: a revoked session may keep working for up to
 * CACHE_TTL_MS — but only on an instance that already verified it, and only for
 * a copy of the cookie taken elsewhere. The user's own browser is unaffected,
 * because sign-out clears the cookie there. `revokeSessions` also evicts
 * locally, so on a single instance revocation stays immediate.
 *
 * Cached by cookie value, never by uid: two sessions for the same user must be
 * revocable independently.
 */
const CACHE_TTL_MS = 60_000;

/** Bounded so a burst of distinct cookies cannot grow this without limit. */
const CACHE_MAX_ENTRIES = 5_000;

interface CacheEntry {
  identity: VerifiedIdentity;
  expiresAt: number;
}

const sessionCache = new Map<string, CacheEntry>();

function cacheGet(cookieValue: string): VerifiedIdentity | null {
  const hit = sessionCache.get(cookieValue);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    sessionCache.delete(cookieValue);
    return null;
  }
  return hit.identity;
}

function cachePut(cookieValue: string, identity: VerifiedIdentity): void {
  if (sessionCache.size >= CACHE_MAX_ENTRIES) {
    // Evict the oldest insertion — Map preserves insertion order. Crude, but
    // entries live 60s anyway, so precision here buys nothing.
    const oldest = sessionCache.keys().next().value;
    if (oldest !== undefined) sessionCache.delete(oldest);
  }
  sessionCache.set(cookieValue, {
    identity,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/** Drops every cached session for a uid, so revocation is immediate locally. */
function cacheEvictUid(uid: string): void {
  for (const [key, entry] of sessionCache) {
    if (entry.identity.uid === uid) sessionCache.delete(key);
  }
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
    const cached = cacheGet(cookieValue);
    if (cached) return cached;

    try {
      // `true` is checkRevoked — see the cache note above for why it stays on.
      const decoded = await auth().verifySessionCookie(cookieValue, true);
      const identity: VerifiedIdentity = {
        uid: decoded.uid,
        email: decoded.email ?? null,
        emailVerified: Boolean(decoded.email_verified),
        signInProvider: decoded.firebase?.sign_in_provider ?? null,
      };
      cachePut(cookieValue, identity);
      return identity;
    } catch {
      // Failures are NOT cached: an expired or revoked cookie must be re-checked
      // every time, or a transient Firebase outage would pin someone as signed
      // out for the whole TTL.
      return null;
    }
  }

  async revokeSessions(uid: string): Promise<void> {
    // Evict FIRST. If the Firebase call throws, the local cache is still clear,
    // so this instance stops honouring the session either way.
    cacheEvictUid(uid);
    // Deliberately unguarded: the caller must surface a failure rather than
    // reporting a successful sign-out that didn't happen.
    await auth().revokeRefreshTokens(uid);
  }

  async deleteIdentity(uid: string): Promise<void> {
    cacheEvictUid(uid);
    await auth().deleteUser(uid);
  }
}
