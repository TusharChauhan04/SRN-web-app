"use client";

import { useActionState } from "react";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { createRequirement, type FormState } from "../actions";

/** Categories mirror the ones the mobile app posts against. */
const CATEGORIES = [
  "Web Development",
  "Mobile Development",
  "Design",
  "Writing & Content",
  "Marketing",
  "Data & Analytics",
  "Electrical",
  "Plumbing",
  "Painting",
  "Carpentry",
  "Cleaning",
  "Tutoring",
  "Other",
];

export function NewRequirementForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createRequirement,
    {},
  );

  return (
    <form action={formAction} className="space-y-6">
      <Card className="space-y-5 p-6">
        <Field
          label="Title"
          htmlFor="title"
          hint="A clear one-liner. This is what providers see first."
        >
          <Input
            id="title"
            name="title"
            required
            minLength={8}
            maxLength={140}
            placeholder="Build a customer-facing shipment tracking portal"
          />
        </Field>

        <Field label="Category" htmlFor="category">
          <Select id="category" name="category" required defaultValue="">
            <option value="" disabled>
              Choose a category
            </option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Description"
          htmlFor="description"
          hint="What needs doing, what done looks like, and anything a provider must know to quote accurately."
        >
          <Textarea
            id="description"
            name="description"
            required
            minLength={30}
            maxLength={5000}
            rows={7}
          />
        </Field>

        <Field
          label="Skills needed"
          htmlFor="skillsNeeded"
          hint="Comma separated. These decide which providers see your requirement."
        >
          <Input
            id="skillsNeeded"
            name="skillsNeeded"
            maxLength={400}
            placeholder="react, typescript, postgres"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum budget (₹)" htmlFor="minBudget">
            <Input
              id="minBudget"
              name="minBudget"
              type="number"
              inputMode="numeric"
              required
              min={0}
              step={100}
              placeholder="50000"
            />
          </Field>
          <Field label="Maximum budget (₹)" htmlFor="maxBudget">
            <Input
              id="maxBudget"
              name="maxBudget"
              type="number"
              inputMode="numeric"
              required
              min={0}
              step={100}
              placeholder="150000"
            />
          </Field>
        </div>

        <Field
          label="Location"
          htmlFor="location"
          hint="Leave blank or write Remote if location doesn't matter."
        >
          <Input
            id="location"
            name="location"
            maxLength={120}
            placeholder="Bengaluru, KA"
          />
        </Field>
      </Card>

      {state.error ? <Alert>{state.error}</Alert> : null}

      <div className="flex justify-end gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner className="h-4 w-4" /> : null}
          Post requirement
        </Button>
      </div>
    </form>
  );
}
