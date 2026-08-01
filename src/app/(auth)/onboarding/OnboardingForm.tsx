"use client";

import { useActionState, useState } from "react";
import {
  ROLE_COLORS,
  ROLE_LABELS,
  type UserRole,
} from "@/lib/repositories/types";
import { Alert, Button, Card, Field, Input, Spinner } from "@/components/ui";
import { completeOnboarding, type OnboardingState } from "./actions";

/** Admin is granted, not self-selected — so it isn't offered here. */
const SELECTABLE_ROLES: UserRole[] = [
  "business",
  "customer",
  "digital",
  "local",
];

const ROLE_BLURB: Record<string, string> = {
  business: "Post requirements and hire providers for your company.",
  customer: "Find and book trusted providers for personal jobs.",
  digital: "Offer remote skills — development, design, writing, marketing.",
  local: "Offer on-site services in your area — repairs, trades, tuition.",
};

export function OnboardingForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(
    completeOnboarding,
    {},
  );
  const [role, setRole] = useState<UserRole>("customer");

  const isProvider = role === "digital" || role === "local";
  const isBusiness = role === "business";

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Tell us who you are
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          This decides what you see. {email ? `Signed in as ${email}.` : ""}
        </p>
      </div>

      <form action={formAction} className="space-y-6">
        <input type="hidden" name="role" value={role} />

        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-medium">I want to…</legend>
          {SELECTABLE_ROLES.map((r) => {
            const selected = role === r;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={selected}
                onClick={() => setRole(r)}
                className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${
                  selected
                    ? "border-[var(--primary)] bg-[var(--primary)]/5"
                    : "border-[var(--border)] hover:bg-[var(--muted)]"
                }`}
              >
                <span
                  aria-hidden
                  className="mt-0.5 h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: ROLE_COLORS[r] }}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{ROLE_LABELS[r]}</span>
                  <span className="block text-sm text-[var(--muted-foreground)]">
                    {ROLE_BLURB[r]}
                  </span>
                </span>
              </button>
            );
          })}
        </fieldset>

        <Card className="space-y-4 p-5">
          <Field label="Full name" htmlFor="name">
            <Input id="name" name="name" required minLength={2} maxLength={80} />
          </Field>

          <Field
            label="Location"
            htmlFor="location"
            hint={
              role === "local"
                ? "Customers search by location, so this matters for you."
                : "Optional."
            }
          >
            <Input
              id="location"
              name="location"
              maxLength={120}
              placeholder="Bengaluru, KA"
            />
          </Field>

          {isProvider ? (
            <>
              <Field
                label="Professional title"
                htmlFor="title"
                hint="Shown at the top of your profile."
              >
                <Input
                  id="title"
                  name="title"
                  maxLength={120}
                  placeholder={
                    role === "digital"
                      ? "Full-stack developer"
                      : "Certified electrician"
                  }
                />
              </Field>
              <Field
                label="Skills"
                htmlFor="skills"
                hint="Comma separated. These decide which requirements you're matched to."
              >
                <Input
                  id="skills"
                  name="skills"
                  maxLength={400}
                  placeholder={
                    role === "digital"
                      ? "react, typescript, node"
                      : "wiring, inverter, repair"
                  }
                />
              </Field>
            </>
          ) : null}

          {isBusiness ? (
            <>
              <Field label="Company name" htmlFor="companyName">
                <Input id="companyName" name="companyName" maxLength={120} />
              </Field>
              <Field label="Industry" htmlFor="industry">
                <Input
                  id="industry"
                  name="industry"
                  maxLength={120}
                  placeholder="Supply Chain"
                />
              </Field>
            </>
          ) : null}

          <Field
            label="Referral code"
            htmlFor="referralCode"
            hint="Optional — if someone invited you."
          >
            <Input
              id="referralCode"
              name="referralCode"
              maxLength={20}
              className="uppercase"
            />
          </Field>
        </Card>

        {state.error ? <Alert>{state.error}</Alert> : null}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Spinner className="h-4 w-4" /> : null}
          Continue as {ROLE_LABELS[role]}
        </Button>
      </form>
    </div>
  );
}
