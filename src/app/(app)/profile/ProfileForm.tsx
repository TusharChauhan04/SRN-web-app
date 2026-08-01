"use client";

import { useActionState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Field,
  Input,
  RoleBadge,
  Spinner,
  Textarea,
} from "@/components/ui";
import type { User } from "@/lib/repositories/types";
import type { ProfileState } from "./page";

export function ProfileForm({
  user,
  action,
}: {
  user: User;
  action: (prev: ProfileState, formData: FormData) => Promise<ProfileState>;
}) {
  const [state, formAction, pending] = useActionState<ProfileState, FormData>(
    action,
    {},
  );

  const isProvider = user.role === "digital" || user.role === "local";
  const isBusiness = user.role === "business";

  return (
    <form action={formAction} className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <Avatar name={user.name} src={user.avatarUrl} size={64} />
          <div className="min-w-0">
            <RoleBadge role={user.role} />
            <p className="mt-2 truncate text-sm text-[var(--muted-foreground)]">
              {user.email}
            </p>
            {/*
              Avatar upload lands with the storage provider in Phase 4. The
              field already exists on the profile, so wiring it is adding the
              input, not reshaping the flow.
            */}
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Photo upload isn&apos;t available yet.
            </p>
          </div>
        </div>
      </Card>

      <Card className="space-y-5 p-6">
        <Field label="Full name" htmlFor="name">
          <Input
            id="name"
            name="name"
            defaultValue={user.name}
            required
            minLength={2}
            maxLength={80}
          />
        </Field>

        <Field label="Location" htmlFor="location">
          <Input
            id="location"
            name="location"
            defaultValue={user.location ?? ""}
            maxLength={120}
            placeholder="Bengaluru, KA"
          />
        </Field>

        <Field
          label="Bio"
          htmlFor="bio"
          hint="A short introduction. This is the first thing people read."
        >
          <Textarea
            id="bio"
            name="bio"
            defaultValue={user.bio ?? ""}
            maxLength={2000}
            rows={5}
          />
        </Field>

        {isProvider ? (
          <>
            <Field label="Professional title" htmlFor="title">
              <Input
                id="title"
                name="title"
                defaultValue={user.title ?? ""}
                maxLength={120}
                placeholder="Full-stack developer"
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
                defaultValue={user.skills.join(", ")}
                maxLength={400}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Hourly rate (₹)" htmlFor="hourlyRate">
                <Input
                  id="hourlyRate"
                  name="hourlyRate"
                  type="number"
                  min={0}
                  step={50}
                  defaultValue={user.hourlyRate ?? ""}
                />
              </Field>

              {user.role === "local" ? (
                <Field
                  label="Service radius (km)"
                  htmlFor="serviceRadiusKm"
                  hint="How far you'll travel for a job."
                >
                  <Input
                    id="serviceRadiusKm"
                    name="serviceRadiusKm"
                    type="number"
                    min={0}
                    max={500}
                    defaultValue={user.serviceRadiusKm ?? ""}
                  />
                </Field>
              ) : null}
            </div>

            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="isAvailable"
                defaultChecked={user.isAvailable}
                className="h-4 w-4 rounded border-[var(--input)]"
              />
              <span>
                Available for new work
                <span className="block text-[var(--muted-foreground)]">
                  Turn this off to stay listed but stop appearing as available.
                </span>
              </span>
            </label>
          </>
        ) : null}

        {isBusiness ? (
          <>
            <Field label="Company name" htmlFor="companyName">
              <Input
                id="companyName"
                name="companyName"
                defaultValue={user.companyName ?? ""}
                maxLength={120}
              />
            </Field>
            <Field label="Industry" htmlFor="industry">
              <Input
                id="industry"
                name="industry"
                defaultValue={user.industry ?? ""}
                maxLength={120}
              />
            </Field>
          </>
        ) : null}
      </Card>

      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.saved ? <Alert tone="info">Profile saved.</Alert> : null}

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner className="h-4 w-4" /> : null}
          Save changes
        </Button>
      </div>
    </form>
  );
}
