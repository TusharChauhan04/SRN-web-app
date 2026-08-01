"use server";

/**
 * Requirement and quote mutations.
 *
 * Server Actions rather than client fetches because these are form posts. They
 * still go through the gateway, so validation, rate limiting, access policy and
 * ownership checks apply exactly as they would over HTTP.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gateway, GatewayError } from "@/lib/gateway";

export type FormState = { error?: string; ok?: boolean };

/** Turns a gateway failure into a message the form can render. */
async function run<T>(
  fn: () => Promise<T>,
): Promise<{ data?: T; error?: string }> {
  try {
    return { data: await fn() };
  } catch (err) {
    if (err instanceof GatewayError) return { error: err.message };
    throw err;
  }
}

function num(value: FormDataEntryValue | null): number {
  return Number(String(value ?? "").replace(/[^0-9.]/g, ""));
}

function skills(value: FormDataEntryValue | null): string[] | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function createRequirement(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await run(() =>
    gateway.requirements.create({
      title: String(formData.get("title") ?? ""),
      category: String(formData.get("category") ?? ""),
      description: String(formData.get("description") ?? ""),
      skillsNeeded: skills(formData.get("skillsNeeded")),
      minBudget: num(formData.get("minBudget")),
      maxBudget: num(formData.get("maxBudget")),
      location: String(formData.get("location") ?? "") || undefined,
    }),
  );

  if (result.error) return { error: result.error };

  revalidatePath("/requirements");
  redirect(`/requirements/${result.data!.id}`);
}

export async function submitQuote(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const requirementId = String(formData.get("requirementId") ?? "");

  const result = await run(() =>
    gateway.quotes.submit({
      requirementId,
      amount: num(formData.get("amount")),
      durationDays: Number(formData.get("durationDays")),
      message: String(formData.get("message") ?? "") || undefined,
    }),
  );

  if (result.error) return { error: result.error };

  revalidatePath(`/requirements/${requirementId}`);
  redirect(`/requirements/${requirementId}`);
}

export async function shortlistQuote(formData: FormData): Promise<void> {
  const id = String(formData.get("quoteId") ?? "");
  await run(() => gateway.quotes.shortlist({ id }));
  revalidatePath(`/requirements/${String(formData.get("requirementId") ?? "")}`);
}

export async function rejectQuote(formData: FormData): Promise<void> {
  const id = String(formData.get("quoteId") ?? "");
  await run(() => gateway.quotes.reject({ id }));
  revalidatePath(`/requirements/${String(formData.get("requirementId") ?? "")}`);
}

export async function acceptQuote(formData: FormData): Promise<void> {
  const quoteId = String(formData.get("quoteId") ?? "");
  const result = await run(() => gateway.bookings.acceptQuote({ quoteId }));

  // Accepting creates a booking — send them straight to it.
  if (result.data) {
    revalidatePath("/bookings");
    redirect(`/bookings/${result.data.id}`);
  }
}

export async function closeRequirement(formData: FormData): Promise<void> {
  const id = String(formData.get("requirementId") ?? "");
  await run(() => gateway.requirements.setStatus({ id, status: "closed" }));
  revalidatePath(`/requirements/${id}`);
}
