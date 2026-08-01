"use client";

/**
 * Client-side auth context — the web counterpart of mobile's
 * src/contexts/AuthContext.tsx.
 *
 * Differences from mobile, all deliberate:
 *  - AsyncStorage persistence is replaced by an httpOnly session cookie minted
 *    by /api/auth/session. The server trusts the cookie, not this state.
 *  - FCM token registration is omitted: web push is deferred
 *    (WEB_MIGRATION_PLAN.md §5). The data path still exists server-side.
 *  - The profile is passed in from the server layout rather than fetched on
 *    mount, so there is no authenticated-but-blank flash on first paint.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type { User } from "@/lib/repositories/types";

interface AuthContextValue {
  /** The onboarded profile, or null when signed out / not yet onboarded. */
  user: User | null;
  busy: boolean;
  error: string | null;
  /** Non-error feedback, e.g. "verification email sent". */
  notice: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (
    email: string,
    password: string,
    name: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Maps Firebase's error codes to something a person can act on. */
function friendlyError(err: unknown): string {
  const code =
    typeof err === "object" && err && "code" in err
      ? String((err as { code: unknown }).code)
      : "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password combination doesn't match an account.";
    case "auth/email-already-in-use":
      return "An account already exists with that email. Try signing in instead.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "";
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups for this site and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return err instanceof Error
        ? err.message
        : "Something went wrong signing you in.";
  }
}

export function AuthProvider({
  children,
  initialUser,
}: {
  children: ReactNode;
  initialUser: User | null;
}) {
  const router = useRouter();
  // Read the prop directly rather than seeding state from it. `router.refresh()`
  // re-renders the server layout with a fresh profile while this provider stays
  // mounted, so a useState copy would serve the value from first paint forever.
  const user = initialUser;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Exchanges the Firebase ID token for the server session cookie. Every
   * sign-in path funnels through here — the cookie is what the server checks.
   */
  const establishSession = useCallback(async (idToken: string) => {
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? "Could not start a session.");
    }
    // Server components read the cookie, so a refresh is what reveals the
    // signed-in UI. The destination is decided server-side by role.
    router.replace("/");
    router.refresh();
  }, [router]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (err) {
        const message = friendlyError(err);
        // Empty message means the user cancelled — not worth surfacing.
        if (message) setError(message);
      } finally {
        // Must reset on success too. Clearing it only in `catch` left the
        // button permanently disabled on any path that doesn't navigate away.
        setBusy(false);
      }
    },
    [],
  );

  const signInWithGoogle = useCallback(
    () =>
      run(async () => {
        const auth = getFirebaseAuth();
        const provider = new GoogleAuthProvider();
        const credential = await signInWithPopup(auth, provider);
        await establishSession(await credential.user.getIdToken());
      }),
    [run, establishSession],
  );

  const signInWithEmail = useCallback(
    (email: string, password: string) =>
      run(async () => {
        const auth = getFirebaseAuth();
        const credential = await signInWithEmailAndPassword(
          auth,
          email,
          password,
        );
        await establishSession(await credential.user.getIdToken());
      }),
    [run, establishSession],
  );

  const signUpWithEmail = useCallback(
    (email: string, password: string, name: string) =>
      run(async () => {
        const auth = getFirebaseAuth();
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        // Carry the name through so onboarding can prefill it.
        await updateProfile(credential.user, { displayName: name });

        // The session endpoint rejects unverified password sign-ups, so send
        // the verification mail and stop here rather than bouncing off a 403.
        await sendEmailVerification(credential.user);
        await firebaseSignOut(auth).catch(() => {});

        setNotice(
          `We've sent a verification link to ${email}. Confirm it, then sign in.`,
        );
      }),
    [run],
  );

  const signOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Clear the server cookie first: if the page reloads mid-sign-out, the
      // server must not still consider the session valid.
      const res = await fetch("/api/auth/session", { method: "DELETE" });
      if (!res.ok) {
        // The server could not revoke the session. Say so rather than
        // pretending — this is the action users take when they think their
        // account is compromised.
        throw new Error(
          "We couldn't fully sign you out. Check your connection and try again.",
        );
      }

      await firebaseSignOut(getFirebaseAuth()).catch(() => {
        // Firebase may already consider us signed out; the server cookie is
        // revoked, which is what actually matters.
      });
      router.replace("/login");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't sign you out. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      busy,
      error,
      notice,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      clearError: () => setError(null),
    }),
    [
      user,
      busy,
      error,
      notice,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOut,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}