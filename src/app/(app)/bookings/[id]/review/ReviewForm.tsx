"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Card, Field, Spinner, Textarea } from "@/components/ui";
import { createReview, type FormState } from "../../actions";

const LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createReview,
    {},
  );
  const [rating, setRating] = useState(5);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="rating" value={rating} />

      <Card className="space-y-5 p-6">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Rating</legend>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRating(value)}
                // Buttons rather than a radio group so the whole star is a
                // target; aria-pressed keeps the state announced.
                aria-pressed={rating === value}
                aria-label={`${value} star${value === 1 ? "" : "s"}`}
                className="rounded-lg p-1 text-3xl leading-none transition hover:scale-110"
              >
                <span className={value <= rating ? "text-amber-700" : "text-[var(--border)]"}>
                  ★
                </span>
              </button>
            ))}
            <span className="ml-3 text-sm text-[var(--muted-foreground)]">
              {LABELS[rating]}
            </span>
          </div>
        </fieldset>

        <Field
          label="Comment"
          htmlFor="comment"
          hint="What went well, what didn't. Specifics help the next customer more than a score does."
        >
          <Textarea id="comment" name="comment" maxLength={2000} rows={6} />
        </Field>
      </Card>

      {state.error ? <Alert>{state.error}</Alert> : null}

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner className="h-4 w-4" /> : null}
          Submit review
        </Button>
      </div>
    </form>
  );
}
