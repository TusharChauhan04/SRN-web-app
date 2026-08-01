"use client";

import { useActionState } from "react";
import type { BlockedDate, WorkingHours } from "@/lib/repositories/types";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Spinner,
  formatDate,
} from "@/components/ui";
import type { AvailabilityState } from "./page";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function AvailabilityEditor({
  workingHours,
  blockedDates,
  saveAction,
  blockAction,
  unblockAction,
}: {
  workingHours: WorkingHours[];
  blockedDates: BlockedDate[];
  saveAction: (
    prev: AvailabilityState,
    formData: FormData,
  ) => Promise<AvailabilityState>;
  blockAction: (formData: FormData) => Promise<void>;
  unblockAction: (formData: FormData) => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState<
    AvailabilityState,
    FormData
  >(saveAction, {});

  const byDay = new Map(workingHours.map((h) => [h.dayOfWeek, h]));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <form action={formAction}>
        <Card>
          <CardHeader
            title="Working hours"
            description="Uncheck a day to mark yourself unavailable for it."
          />
          <div className="divide-y divide-[var(--border)]">
            {DAYS.map((label, day) => {
              const existing = byDay.get(day);
              return (
                <div
                  key={day}
                  className="flex flex-wrap items-center gap-4 px-5 py-3"
                >
                  <label className="flex min-w-36 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      name={`enabled-${day}`}
                      defaultChecked={existing?.isEnabled ?? false}
                      className="h-4 w-4 rounded border-[var(--input)]"
                    />
                    <span className="font-medium">{label}</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <label htmlFor={`start-${day}`} className="sr-only">
                      {label} start time
                    </label>
                    <Input
                      id={`start-${day}`}
                      name={`start-${day}`}
                      type="time"
                      defaultValue={existing?.startTime ?? "09:00"}
                      className="w-32"
                    />
                    <span className="text-sm text-[var(--muted-foreground)]">
                      to
                    </span>
                    <label htmlFor={`end-${day}`} className="sr-only">
                      {label} end time
                    </label>
                    <Input
                      id={`end-${day}`}
                      name={`end-${day}`}
                      type="time"
                      defaultValue={existing?.endTime ?? "17:00"}
                      className="w-32"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-3 border-t border-[var(--border)] p-5">
            {state.error ? <Alert>{state.error}</Alert> : null}
            {state.saved ? <Alert tone="info">Working hours saved.</Alert> : null}

            <Button type="submit" disabled={pending}>
              {pending ? <Spinner className="h-4 w-4" /> : null}
              Save working hours
            </Button>
          </div>
        </Card>
      </form>

      <Card>
        <CardHeader
          title="Blocked dates"
          description="Days you're not available regardless of your working hours."
        />

        <form action={blockAction} className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Date" htmlFor="date">
            {/* Native date input — mobile used a native DateTimePicker. */}
            <Input id="date" name="date" type="date" min={today} required />
          </Field>
          <Field label="Reason" htmlFor="reason" hint="Optional">
            <Input
              id="reason"
              name="reason"
              maxLength={120}
              placeholder="Family function"
            />
          </Field>
          <Button type="submit" variant="outline">
            Block date
          </Button>
        </form>

        {blockedDates.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              title="No blocked dates"
              description="Your working hours apply to every upcoming day."
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {blockedDates.map((blocked) => (
              <li
                key={blocked.id}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <div>
                  <p className="font-medium">{formatDate(blocked.date)}</p>
                  {blocked.reason ? (
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {blocked.reason}
                    </p>
                  ) : null}
                </div>
                <form action={unblockAction}>
                  <input
                    type="hidden"
                    name="date"
                    value={new Date(blocked.date).toISOString().slice(0, 10)}
                  />
                  <Button size="sm" variant="ghost" type="submit">
                    Unblock
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
