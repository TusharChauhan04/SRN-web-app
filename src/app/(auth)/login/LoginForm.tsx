"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { authClient } from "@/lib/providers/auth/client";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Spinner,
} from "@/components/ui";

type Mode = "signin" | "signup";

export function LoginForm() {
  const {
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    busy,
    error,
    notice,
  } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "signin") {
      void signInWithEmail(email, password);
    } else {
      void signUpWithEmail(email, password, name);
    }
  };

  const provider = authClient();

  if (!provider.isConfigured) {
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Sign-in isn&apos;t configured</h1>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          The <code className="font-mono">{provider.name}</code> auth provider is
          selected but missing credentials. Either fill in the{" "}
          <code className="font-mono">NEXT_PUBLIC_FIREBASE_*</code> values in{" "}
          <code className="font-mono">.env.local</code>, or set{" "}
          <code className="font-mono">AUTH_PROVIDER=mock</code> to run without
          them.
        </p>
      </Card>
    );
  }

  const isDevProvider = provider.name === "mock";

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl nm-raised-sm bg-[var(--primary)] text-2xl font-bold text-[var(--primary-foreground)]">
          S
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Skill Requirement Network
        </p>
      </div>

      <Card className="p-6">
        {isDevProvider ? (
          <div className="mb-4">
            <Alert tone="warning">
              Development sign-in — any email works and no password is checked.
              Set <code className="font-mono">AUTH_PROVIDER=firebase</code> with
              credentials for real authentication.
            </Alert>
          </div>
        ) : null}

        {error ? (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        ) : null}

        {notice ? (
          <div className="mb-4">
            <Alert tone="info">{notice}</Alert>
          </div>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => void signInWithGoogle()}
          disabled={busy}
        >
          <GoogleMark />
          Continue with Google
        </Button>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--border)]" />
          <span className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            or
          </span>
          <span className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === "signup" ? (
            <Field label="Full name" htmlFor="name">
              <Input
                id="name"
                name="name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Meera Iyer"
              />
            </Field>
          ) : null}

          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>

          <Field
            label="Password"
            htmlFor="password"
            hint={mode === "signup" ? "At least 6 characters." : undefined}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : null}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>
      </Card>

      <p className="text-center text-sm text-[var(--muted-foreground)]">
        {mode === "signin" ? "New to SRN?" : "Already have an account?"}{" "}
        <button
          type="button"
          className="font-medium text-[var(--primary)] underline-offset-4 hover:underline"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
