import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  AuthServerProvider,
  SessionCookie,
  VerifiedIdentity,
} from "./types";

/**
 * Development identity provider — lets the whole app run before anyone has
 * Firebase credentials.
 *
 * It is a REAL implementation of the interface, not a stub: credentials are
 * HMAC-signed, expire, and are verified properly, so every auth code path
 * (session exchange, role gating, revocation, sign-out) is genuinely exercised.
 * What it does not do is prove who the person is — anyone can mint a credential
 * for any email. That is the entire reason it refuses to run in production.
 *
 * Swapping to Firebase is `AUTH_PROVIDER=firebase` plus credentials. No calling
 * code changes.
 */

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour, like a real ID token
const SESSION_TTL_MS = 5 * 24 * 60 * 60 * 1000;

/** Revoked-at timestamps by uid. In-memory: a dev provider, not a store. */
const revocations = new Map<string, number>();

function secret(): string {
  const value = process.env.MOCK_AUTH_SECRET;
  if (value && value.length >= 16) return value;
  // Stable within a process so tokens survive a page navigation, random across
  // restarts so nothing durable is ever signed with a guessable key.
  return (globalThis as { __mockAuthSecret?: string }).__mockAuthSecret ??= randomUUID();
}

interface TokenPayload {
  uid: string;
  email: string;
  emailVerified: boolean;
  signInProvider: string;
  issuedAt: number;
  expiresAt: number;
  kind: "credential" | "session";
}

function sign(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token: string, kind: TokenPayload["kind"]): TokenPayload | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  // Constant-time compare — habit worth keeping even in a dev provider, so the
  // production one isn't written differently.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as TokenPayload;

    if (payload.kind !== kind) return null;
    if (Date.now() > payload.expiresAt) return null;

    // Honour revocation the same way Firebase's checkRevoked does.
    const revokedAt = revocations.get(payload.uid);
    if (revokedAt && payload.issuedAt < revokedAt) return null;

    return payload;
  } catch {
    return null;
  }
}

/** Deterministic uid per email, so re-signing in returns the same account. */
export function mockUidFor(email: string): string {
  const hash = createHmac("sha256", "mock-uid-namespace")
    .update(email.trim().toLowerCase())
    .digest("hex");
  return `mock_${hash.slice(0, 24)}`;
}

/** Mints a credential. Exported for the mock client provider only. */
export function issueMockCredential(input: {
  email: string;
  emailVerified: boolean;
  signInProvider: string;
}): string {
  const now = Date.now();
  return sign({
    uid: mockUidFor(input.email),
    email: input.email,
    emailVerified: input.emailVerified,
    signInProvider: input.signInProvider,
    issuedAt: now,
    expiresAt: now + TOKEN_TTL_MS,
    kind: "credential",
  });
}

export class MockAuthServerProvider implements AuthServerProvider {
  readonly name = "mock";

  /** Always "configured" — needing no configuration is its whole point. */
  readonly isConfigured = true;

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "MockAuthServerProvider must never run in production — it will " +
          "authenticate anyone as anyone. Set AUTH_PROVIDER=firebase and " +
          "supply Firebase credentials.",
      );
    }
  }

  async verifyCredential(credential: string): Promise<VerifiedIdentity | null> {
    const payload = verify(credential, "credential");
    if (!payload) return null;
    return {
      uid: payload.uid,
      email: payload.email,
      emailVerified: payload.emailVerified,
      signInProvider: payload.signInProvider,
    };
  }

  async createSession(credential: string): Promise<SessionCookie> {
    const payload = verify(credential, "credential");
    if (!payload) throw new Error("Invalid credential");

    const now = Date.now();
    return {
      value: sign({
        ...payload,
        issuedAt: now,
        expiresAt: now + SESSION_TTL_MS,
        kind: "session",
      }),
      maxAgeMs: SESSION_TTL_MS,
    };
  }

  async verifySession(cookieValue: string): Promise<VerifiedIdentity | null> {
    const payload = verify(cookieValue, "session");
    if (!payload) return null;
    return {
      uid: payload.uid,
      email: payload.email,
      emailVerified: payload.emailVerified,
      signInProvider: payload.signInProvider,
    };
  }

  async revokeSessions(uid: string): Promise<void> {
    revocations.set(uid, Date.now());
  }

  async deleteIdentity(uid: string): Promise<void> {
    revocations.set(uid, Date.now());
  }
}
