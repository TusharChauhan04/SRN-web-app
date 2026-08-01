"use client";

/**
 * Browser-side identity providers.
 *
 * Only this file may import `firebase/auth`. UI code talks to
 * `authClient()` and never knows which provider is behind it, so connecting
 * Firebase later changes nothing above this line.
 */
import type {
  AuthClientProvider,
  AuthMethod,
  ClientCredentialResult,
} from "./types";
import { AuthProviderError } from "./types";

// ─────────────────────────── Mock (development) ───────────────────────────

/**
 * Development provider. Mints a credential via a dev-only endpoint that refuses
 * to exist in production, so the app is fully usable before Firebase is wired.
 *
 * Password is accepted and ignored — there is nothing to check it against. That
 * is exactly why the server refuses this provider outside development.
 */
class MockAuthClientProvider implements AuthClientProvider {
  readonly name = "mock";
  readonly isConfigured = true;
  readonly supportedMethods: readonly AuthMethod[] = ["google", "password"];

  private async mint(
    email: string,
    signInProvider: string,
  ): Promise<ClientCredentialResult> {
    const res = await fetch("/api/v1/auth/dev-credential", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, signInProvider }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new AuthProviderError(
        body?.error ?? "Development sign-in is unavailable.",
        "mock/unavailable",
      );
    }

    const body = (await res.json()) as ClientCredentialResult;
    return body;
  }

  async signInWithGoogle(): Promise<ClientCredentialResult> {
    // No popup to show — ask for an address so different roles can be tested.
    const email = window.prompt(
      "Development sign-in — enter any email address:",
      "arjun@dev.test",
    );
    if (!email) {
      throw new AuthProviderError("Sign-in cancelled.", "auth/cancelled");
    }
    return this.mint(email, "google.com");
  }

  async signInWithPassword(email: string): Promise<ClientCredentialResult> {
    return this.mint(email, "password");
  }

  async signUpWithPassword(email: string): Promise<void> {
    // Mock accounts exist the moment they are named; nothing to create.
    await this.mint(email, "password");
  }

  async signOut(): Promise<void> {
    // No client-side session to clear — the httpOnly cookie is authoritative.
  }
}

// ─────────────────────────── Firebase (production) ───────────────────────────

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseClientConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

class FirebaseAuthClientProvider implements AuthClientProvider {
  readonly name = "firebase";
  readonly supportedMethods: readonly AuthMethod[] = ["google", "password"];

  get isConfigured(): boolean {
    return isFirebaseClientConfigured;
  }

  /** Imported lazily so the SDK is not bundled when the mock provider is used. */
  private async auth() {
    const { getApp, getApps, initializeApp } = await import("firebase/app");
    const { getAuth, setPersistence, browserLocalPersistence } = await import(
      "firebase/auth"
    );

    if (!isFirebaseClientConfigured) {
      throw new AuthProviderError(
        "Firebase is not configured. Fill in the NEXT_PUBLIC_FIREBASE_* values.",
        "firebase/not-configured",
      );
    }

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const instance = getAuth(app);
    await setPersistence(instance, browserLocalPersistence).catch(() => {});
    return instance;
  }

  async signInWithGoogle(): Promise<ClientCredentialResult> {
    const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
    const auth = await this.auth();
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    return {
      credential: await result.user.getIdToken(),
      emailVerified: result.user.emailVerified,
    };
  }

  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<ClientCredentialResult> {
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    const auth = await this.auth();
    const result = await signInWithEmailAndPassword(auth, email, password);
    return {
      credential: await result.user.getIdToken(),
      emailVerified: result.user.emailVerified,
    };
  }

  async signUpWithPassword(
    email: string,
    password: string,
    displayName: string,
  ): Promise<void> {
    const {
      createUserWithEmailAndPassword,
      sendEmailVerification,
      signOut,
      updateProfile,
    } = await import("firebase/auth");
    const auth = await this.auth();

    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName });

    // The server rejects unverified password sign-ups, so send the link and
    // sign back out rather than bouncing the user off a guaranteed 403.
    await sendEmailVerification(result.user);
    await signOut(auth).catch(() => {});
  }

  async signOut(): Promise<void> {
    const { signOut } = await import("firebase/auth");
    const auth = await this.auth();
    await signOut(auth).catch(() => {
      // Already signed out client-side; the server cookie is what matters.
    });
  }
}

// ─────────────────────────── Selection ───────────────────────────

/**
 * Must agree with the server's choice, so the provider name is published to the
 * browser as a public env var rather than inferred.
 */
export function configuredClientProviderName(): "firebase" | "mock" {
  const configured = process.env.NEXT_PUBLIC_AUTH_PROVIDER?.toLowerCase();
  if (configured === "firebase" || configured === "mock") return configured;
  return process.env.NODE_ENV === "production" ? "firebase" : "mock";
}

let cached: AuthClientProvider | null = null;

export function authClient(): AuthClientProvider {
  cached ??=
    configuredClientProviderName() === "firebase"
      ? new FirebaseAuthClientProvider()
      : new MockAuthClientProvider();
  return cached;
}

export { AuthProviderError };
export type { AuthClientProvider, ClientCredentialResult };
