import "server-only";

/**
 * Selects the server-side identity provider.
 *
 * This is the single place the choice is made. `AUTH_PROVIDER=firebase` for
 * anything real; `mock` lets the app run end-to-end before credentials exist.
 *
 * Default is deliberately environment-dependent: mock in development so the app
 * works out of the box, firebase in production so a missing env var fails loudly
 * instead of silently authenticating everyone.
 */
import { FirebaseAuthServerProvider } from "./firebase.server";
import { MockAuthServerProvider } from "./mock.server";
import type { AuthServerProvider } from "./types";

export type AuthProviderName = "firebase" | "mock";

export function configuredAuthProviderName(): AuthProviderName {
  const configured = process.env.AUTH_PROVIDER?.toLowerCase();
  if (configured === "firebase" || configured === "mock") return configured;
  return process.env.NODE_ENV === "production" ? "firebase" : "mock";
}

let cached: AuthServerProvider | null = null;

export function authProvider(): AuthServerProvider {
  if (cached) return cached;

  const name = configuredAuthProviderName();
  // MockAuthServerProvider throws if NODE_ENV=production, so a misconfigured
  // deployment fails at startup rather than authenticating strangers.
  cached =
    name === "firebase"
      ? new FirebaseAuthServerProvider()
      : new MockAuthServerProvider();

  return cached;
}

export type { AuthServerProvider, VerifiedIdentity } from "./types";
