"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Input, Spinner } from "@/components/ui";
import { eraseUser, type AdminState } from "../actions";

/**
 * Erasure confirmation.
 *
 * Deliberately friction-heavy: this anonymises the account, deletes every
 * stored file including identity documents, and removes the identity record.
 * None of it is reversible. Typing the word is checked both here and again in
 * the gateway as a literal, so a replayed request can't stand in for intent.
 */
export function EraseUserDialog({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<AdminState, FormData>(
    eraseUser,
    {},
  );

  if (state.ok) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">{state.ok}</p>
    );
  }

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Erase account
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-3">
      <input type="hidden" name="userId" value={userId} />

      <Alert>
        <strong>This cannot be undone.</strong> Erasing {userName} anonymises
        their account, permanently deletes their uploaded files including any
        identity documents, and removes their sign-in. Bookings and reviews stay,
        with their name removed, so other people&apos;s history stays intact.
      </Alert>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label
            htmlFor={`confirm-${userId}`}
            className="mb-1 block text-sm font-medium"
          >
            Type <span className="font-mono">ERASE</span> to confirm
          </label>
          <Input
            id={`confirm-${userId}`}
            name="confirm"
            autoComplete="off"
            placeholder="ERASE"
            required
          />
        </div>

        <Button size="md" variant="danger" type="submit" disabled={pending}>
          {pending ? <Spinner className="h-4 w-4" /> : null}
          Erase permanently
        </Button>
        <Button
          size="md"
          variant="ghost"
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>

      {state.error ? <Alert>{state.error}</Alert> : null}
    </form>
  );
}
