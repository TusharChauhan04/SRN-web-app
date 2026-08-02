"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { callGateway } from "@/lib/gateway/client";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Spinner,
} from "@/components/ui";

interface ChallengeStarted {
  phone: string;
  expiresAt: string;
  /** Only ever present with the development OTP provider. */
  devHint?: string;
}

export function PhoneVerifyForm({ currentPhone }: { currentPhone: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState(currentPhone);
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<ChallengeStarted | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const started = await callGateway<ChallengeStarted>("phone.start", {
        phone,
      });
      setChallenge(started);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send a code.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await callGateway("phone.confirm", { code });
      // Server components hold the verified state, so refresh rather than
      // tracking it separately here.
      router.refresh();
      setChallenge(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't verify that code.");
    } finally {
      setBusy(false);
    }
  };

  if (!challenge) {
    return (
      <form onSubmit={start}>
        <Card className="space-y-5 p-6">
          <Field
            label="Phone number"
            htmlFor="phone"
            hint="Include the country code, e.g. +919812345678."
          >
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              minLength={8}
              maxLength={20}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+919812345678"
            />
          </Field>

          {error ? <Alert>{error}</Alert> : null}

          <Button type="submit" disabled={busy || !phone.trim()}>
            {busy ? <Spinner className="h-4 w-4" /> : null}
            Send verification code
          </Button>
        </Card>
      </form>
    );
  }

  return (
    <form onSubmit={confirm}>
      <Card className="space-y-5 p-6">
        <p className="text-sm">
          We sent a 6-digit code to{" "}
          <span className="font-medium">{challenge.phone}</span>.
        </p>

        {challenge.devHint ? (
          <Alert tone="warning">
            Development mode — no message was actually sent. Your code is{" "}
            <code className="font-mono font-semibold">{challenge.devHint}</code>.
            Configure an SMS provider to send real messages.
          </Alert>
        ) : null}

        <Field label="Verification code" htmlFor="code">
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            minLength={4}
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="font-mono text-lg tracking-[0.5em]"
            placeholder="000000"
          />
        </Field>

        {error ? <Alert>{error}</Alert> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || code.length < 4}>
            {busy ? <Spinner className="h-4 w-4" /> : null}
            Verify
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setChallenge(null);
              setError(null);
            }}
          >
            Use a different number
          </Button>
        </div>

        <p className="text-sm text-[var(--muted-foreground)]">
          Codes expire after 10 minutes. Requesting a new one cancels the old.
        </p>
      </Card>
    </form>
  );
}
