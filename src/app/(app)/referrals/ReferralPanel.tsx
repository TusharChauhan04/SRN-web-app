"use client";

import { useActionState, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Spinner,
} from "@/components/ui";
import type { ReferralState } from "./page";

export function ReferralPanel({
  code,
  alreadyReferred,
  applyAction,
}: {
  code: string;
  alreadyReferred: boolean;
  applyAction: (
    prev: ReferralState,
    formData: FormData,
  ) => Promise<ReferralState>;
}) {
  const [state, formAction, pending] = useActionState<ReferralState, FormData>(
    applyAction,
    {},
  );
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      // navigator.clipboard is the web equivalent of mobile's
      // @react-native-clipboard/clipboard. It needs a secure context, so fall
      // back rather than failing silently on plain http.
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy your referral code:", code);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Your code"
        description="Share this. When someone applies it, you both benefit."
      />
      <div className="space-y-5 p-5">
        <div className="flex items-center gap-3">
          <code className="flex-1 rounded-xl nm-inset px-4 py-3 text-center font-mono text-lg font-semibold tracking-widest">
            {code}
          </code>
          <Button type="button" variant="outline" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <div className="border-t border-[var(--border)] pt-5">
          {alreadyReferred ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              You&apos;ve already used someone&apos;s referral code. Only one can
              be applied per account.
            </p>
          ) : (
            <form action={formAction} className="space-y-3">
              <Field
                label="Were you invited?"
                htmlFor="code"
                hint="Enter someone else's code to credit them. You can only do this once."
              >
                <Input
                  id="code"
                  name="code"
                  maxLength={20}
                  required
                  className="uppercase font-mono tracking-widest"
                  placeholder="SRNXXXXX"
                />
              </Field>

              {state.error ? <Alert>{state.error}</Alert> : null}
              {state.ok ? <Alert tone="info">{state.ok}</Alert> : null}

              <Button type="submit" variant="outline" disabled={pending}>
                {pending ? <Spinner className="h-4 w-4" /> : null}
                Apply code
              </Button>
            </form>
          )}
        </div>
      </div>
    </Card>
  );
}
