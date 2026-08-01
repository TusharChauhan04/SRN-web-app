"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Spinner, Textarea } from "@/components/ui";
import { resolveDispute, type AdminState } from "../actions";

export function ResolveDisputeForm({ disputeId }: { disputeId: string }) {
  const [state, formAction, pending] = useActionState<AdminState, FormData>(
    resolveDispute,
    {},
  );

  if (state.ok) return <Alert tone="info">{state.ok}</Alert>;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="disputeId" value={disputeId} />

      <Field
        label="Decision"
        htmlFor={`resolution-${disputeId}`}
        hint="Both parties see this. Explain what you decided and why."
      >
        <Textarea
          id={`resolution-${disputeId}`}
          name="resolution"
          required
          minLength={10}
          maxLength={2000}
          rows={3}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        {/*
          Two submit buttons sharing one form — the value of the clicked button
          is what gets submitted, so the operator picks the outcome and writes
          the reasoning in one action rather than two.
        */}
        <Button
          type="submit"
          name="outcome"
          value="resolved"
          disabled={pending}
        >
          {pending ? <Spinner className="h-4 w-4" /> : null}
          Uphold dispute
        </Button>
        <Button
          type="submit"
          name="outcome"
          value="rejected"
          variant="outline"
          disabled={pending}
        >
          Dismiss dispute
        </Button>
      </div>

      {state.error ? <Alert>{state.error}</Alert> : null}
    </form>
  );
}
