/**
 * Identity provider abstraction.
 *
 * Firebase Auth is the intended production provider, but nothing outside this
 * directory may import `firebase/auth` or `firebase-admin`. Everything else in
 * the app speaks this interface, so connecting the real thing later is a config
 * change plus one implementation file — never a rewrite.
 *
 * There are two sides because identity genuinely has two:
 *  - `AuthClientProvider` runs in the browser and produces a credential.
 *  - `AuthServerProvider` runs on the server and decides whether to believe it.
 *
 * The server side is the trust boundary. The client side is a convenience.
 */

/** What the server learned from a verified credential. Never trusted for role. */
export interface VerifiedIdentity {
  /** Stable provider-side user id. Becomes `User.id` in our database. */
  uid: string;
  email: string | null;
  /** Whether the provider asserts the email address is confirmed. */
  emailVerified: boolean;
  /** e.g. "password", "google.com". Drives the email-verification gate. */
  signInProvider: string | null;
}

export interface SessionCookie {
  value: string;
  maxAgeMs: number;
}

/**
 * Server-side identity operations. Implementations must FAIL CLOSED: a
 * credential that cannot be positively verified is rejected, never assumed.
 */
export interface AuthServerProvider {
  /** Human-readable name, surfaced by /api/healthz. */
  readonly name: string;
  /** False when credentials are missing, so health checks can report it. */
  readonly isConfigured: boolean;

  /** Verifies a client credential. Returns null if it cannot be trusted. */
  verifyCredential(credential: string): Promise<VerifiedIdentity | null>;

  /** Exchanges a verified credential for a long-lived session cookie value. */
  createSession(credential: string): Promise<SessionCookie>;

  /** Verifies a session cookie, honouring revocation. Null if invalid. */
  verifySession(cookieValue: string): Promise<VerifiedIdentity | null>;

  /**
   * Invalidates every outstanding session for a user.
   *
   * Must throw on failure rather than resolving — sign-out is what people do
   * when they believe an account is compromised, so a silent failure there is
   * worse than an error.
   */
  revokeSessions(uid: string): Promise<void>;

  /** Deletes the identity record. Used by GDPR erasure. */
  deleteIdentity(uid: string): Promise<void>;
}

export type AuthMethod = "google" | "password";

export interface ClientCredentialResult {
  /** Opaque credential to hand to the server for verification. */
  credential: string;
  emailVerified: boolean;
}

/** Browser-side identity operations. */
export interface AuthClientProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  /** Which sign-in methods this provider actually supports. */
  readonly supportedMethods: readonly AuthMethod[];

  signInWithGoogle(): Promise<ClientCredentialResult>;
  signInWithPassword(
    email: string,
    password: string,
  ): Promise<ClientCredentialResult>;
  /**
   * Creates an account and sends verification. Deliberately does NOT return a
   * credential: the server rejects unverified password sign-ups, so returning
   * one would only produce a guaranteed 403.
   */
  signUpWithPassword(
    email: string,
    password: string,
    displayName: string,
  ): Promise<void>;
  signOut(): Promise<void>;
}

/** Thrown for user-facing auth failures that carry a safe message. */
export class AuthProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "AuthProviderError";
  }
}
