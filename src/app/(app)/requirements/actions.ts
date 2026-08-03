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

/**
 * Sends the user back to the page they acted from, with the reason visible.
 *
 * These four actions are posted from SERVER components, so there is no
 * `useActionState` to return a message into — and returning one from a
 * `Promise<void>` action, which is what they used to do, means the error is
 * simply dropped. The user clicked "Accept", the quote was already taken by
 * someone else, and the page re-rendered looking untouched.
 *
 * A redirect carrying the message is the RSC-native answer: it survives without
 * client JavaScript, and the pages render `searchParams.error` as a banner.
 */
function failBack(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
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

/**
 * Where to send the user back to. Falls back to the quote page when the form
 * did not carry a requirement id.
 */
function originOf(formData: FormData): string {
  const requirementId = String(formData.get("requirementId") ?? "");
  if (requirementId) return `/requirements/${requirementId}`;
  return `/quotes/${String(formData.get("quoteId") ?? "")}`;
}

export async function shortlistQuote(formData: FormData): Promise<void> {
  const id = String(formData.get("quoteId") ?? "");
  const origin = originOf(formData);
  const result = await run(() => gateway.quotes.shortlist({ id }));
  if (result.error) failBack(origin, result.error);
  revalidatePath(origin);
}

export async function rejectQuote(formData: FormData): Promise<void> {
  const id = String(formData.get("quoteId") ?? "");
  const origin = originOf(formData);
  const result = await run(() => gateway.quotes.reject({ id }));
  if (result.error) failBack(origin, result.error);
  revalidatePath(origin);
}

export async function acceptQuote(formData: FormData): Promise<void> {
  const quoteId = String(formData.get("quoteId") ?? "");
  const origin = originOf(formData);
  const result = await run(() => gateway.bookings.acceptQuote({ quoteId }));

  /*
   * The failure that matters here is losing the race for a requirement: two
   * owners' tabs, or a double click, and the second attempt is a conflict. That
   * MUST be visible — silently doing nothing is how someone concludes the
   * button is broken and clicks it repeatedly.
   */
  if (result.error) failBack(origin, result.error);

  // Accepting creates a booking — send them straight to it.
  revalidatePath("/bookings");
  redirect(`/bookings/${result.data!.id}`);
}

export async function closeRequirement(formData: FormData): Promise<void> {
  const id = String(formData.get("requirementId") ?? "");
  const result = await run(() =>
    gateway.requirements.setStatus({ id, status: "closed" }),
  );
  if (result.error) failBack(`/requirements/${id}`, result.error);
  revalidatePath(`/requirements/${id}`);
}
