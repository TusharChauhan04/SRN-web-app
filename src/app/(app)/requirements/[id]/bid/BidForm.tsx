"use client";

import { useActionState, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Spinner,
  Textarea,
  formatCurrency,
} from "@/components/ui";
import { submitQuote, type FormState } from "../../actions";

export function BidForm({
  requirementId,
  minBudget,
  maxBudget,
}: {
  requirementId: string;
  minBudget: number;
  maxBudget: number;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    submitQuote,
    {},
  );
  const [amount, setAmount] = useState("");

  const numeric = Number(amount);
  // Advisory only — a provider may legitimately quote outside the stated range,
  // so this warns rather than blocking submission.
  const overBudget = numeric > 0 && numeric > maxBudget;
  const underBudget = numeric > 0 && numeric < minBudget;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="requirementId" value={requirementId} />

      <Card className="space-y-5 p-6">
        <Field
          label="Your quote (₹)"
          htmlFor="amount"
          hint={
            overBudget
              ? `Above the client's maximum of ${formatCurrency(maxBudget)} — explain why in your message.`
              : underBudget
                ? `Below the client's minimum of ${formatCurrency(minBudget)}.`
                : "The total you'd charge for this work."
          }
        >
          <Input
            id="amount"
            name="amount"
            type="number"
            inputMode="numeric"
            required
            min={1}
            step={100}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={String(maxBudget)}
          />
        </Field>

        <Field
          label="Delivery time (days)"
          htmlFor="durationDays"
          hint="Working days from acceptance to delivery."
        >
          <Input
            id="durationDays"
            name="durationDays"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={365}
            placeholder="30"
          />
        </Field>

        <Field
          label="Message"
          htmlFor="message"
          hint="Why you're a good fit, relevant experience, what's included. This is what wins the bid."
        >
          <Textarea id="message" name="message" maxLength={2000} rows={6} />
        </Field>
      </Card>

      {state.error ? <Alert>{state.error}</Alert> : null}

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner className="h-4 w-4" /> : null}
          Submit quote
        </Button>
      </div>
    </form>
  );
}
