"use client";

/**
 * Client-side auth state — the web counterpart of mobile's AuthContext.
 *
 * Two boundaries are respected here:
 *  - it never imports an auth SDK; it goes through `authClient()`, so whether
 *    the provider is Firebase or the dev mock is invisible to the UI;
 *  - it never touches application data; the session exchange goes over the
 *    gateway's HTTP surface like any other client-side call.
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
import { authClient, AuthProviderError } from "@/lib/providers/auth/client";
import { callGateway, GatewayCallError } from "@/lib/gateway/client";
import type { User } from "@/lib/repositories/types";

interface AuthContextValue {
  user: User | null;
  busy: boolean;
  error: string | null;
  /** Non-error feedback, e.g. "verification email sent". */
  notice: string | null;
  /** Which provider is active — lets the UI explain dev-mode sign-in. */
  providerName: string;
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

function friendlyError(err: unknown): string {
  if (err instanceof AuthProviderError) {
    // Cancellation is a choice, not a failure worth reporting.
    if (err.code === "auth/cancelled") return "";
    return err.message;
  }
  if (err instanceof GatewayCallError) return err.message;

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
      return "Your browser blocked the sign-in popup. Allow popups and try again.";
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
  // Read the prop directly. `router.refresh()` re-renders the server layout
  // with a fresh profile while this provider stays mounted, so a useState copy
  // would serve the value from first paint forever.
  const user = initialUser;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Exchanges a provider credential for the server session cookie. */
  const establishSession = useCallback(
    async (credential: string) => {
      await callGateway("auth.createSession", { credential });
      // Server components read the cookie, so a refresh is what reveals the
      // signed-in UI. Destination is decided server-side by role.
      router.replace("/");
      router.refresh();
    },
    [router],
  );

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      const message = friendlyError(err);
      if (message) setError(message);
    } finally {
      // Must reset on success too, or any path that doesn't navigate away
      // leaves the button permanently disabled.
      setBusy(false);
    }
  }, []);

  const signInWithGoogle = useCallback(
    () =>
      run(async () => {
        const { credential } = await authClient().signInWithGoogle();
        await establishSession(credential);
      }),
    [run, establishSession],
  );

  const signInWithEmail = useCallback(
    (email: string, password: string) =>
      run(async () => {
        const { credential } = await authClient().signInWithPassword(
          email,
          password,
        );
        await establishSession(credential);
      }),
    [run, establishSession],
  );

  const signUpWithEmail = useCallback(
    (email: string, password: string, name: string) =>
      run(async () => {
        await authClient().signUpWithPassword(email, password, name);
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
      // Clear the server session first: if the page reloads mid-sign-out, the
      // server must not still consider it valid.
      // No payload: the server revokes the session it verified for this request.
      await callGateway("auth.destroySession");
      await authClient().signOut();
      router.replace("/login");
      router.refresh();
    } catch (err) {
      setError(
        friendlyError(err) ||
          "We couldn't sign you out. Check your connection and try again.",
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
      providerName: authClient().name,
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
