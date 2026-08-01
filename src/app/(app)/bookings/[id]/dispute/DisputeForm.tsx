"use client";

import { useActionState } from "react";
import {
  Alert,
  Button,
  Card,
  Field,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { raiseDispute, type FormState } from "../../actions";

/** Reasons mirror the ones the mobile dispute screen offers. */
const REASONS = [
  "Work not delivered",
  "Work below agreed quality",
  "Delivered late",
  "Provider stopped responding",
  "Payment disagreement",
  "Scope disagreement",
  "Other",
];

export function DisputeForm({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    raiseDispute,
    {},
  );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="bookingId" value={bookingId} />

      <Card className="space-y-5 p-6">
        <Field label="Reason" htmlFor="reason">
          <Select id="reason" name="reason" required defaultValue="">
            <option value="" disabled>
              Choose a reason
            </option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="What happened"
          htmlFor="details"
          hint="Dates, what was agreed, and what actually happened. An administrator reads this alongside the other party's account."
        >
          <Textarea
            id="details"
            name="details"
            required
            minLength={20}
            maxLength={5000}
            rows={8}
          />
        </Field>

        {/*
          Evidence upload lands with the storage provider in Phase 4. The
          gateway already accepts evidenceUrls, so wiring it is adding the
          input — not reshaping the flow.
        */}
        <p className="text-sm text-[var(--muted-foreground)]">
          Attaching files isn&apos;t available yet. Describe the evidence here
          and an administrator will ask for it if needed.
        </p>
      </Card>

      {state.error ? <Alert>{state.error}</Alert> : null}

      <div className="flex justify-end">
        <Button type="submit" size="lg" variant="danger" disabled={pending}>
          {pending ? <Spinner className="h-4 w-4" /> : null}
          Raise dispute
        </Button>
      </div>
    </form>
  );
}
