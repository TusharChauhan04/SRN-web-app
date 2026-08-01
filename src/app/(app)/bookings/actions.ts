"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gateway, GatewayError } from "@/lib/gateway";

export type FormState = { error?: string };

async function run<T>(fn: () => Promise<T>) {
  try {
    return { data: await fn() };
  } catch (err) {
    if (err instanceof GatewayError) return { error: err.message };
    throw err;
  }
}

export async function setBookingStatus(formData: FormData): Promise<void> {
  const id = String(formData.get("bookingId") ?? "");
  const status = String(formData.get("status") ?? "") as
    | "in_progress"
    | "completed"
    | "cancelled";

  await run(() => gateway.bookings.setStatus({ id, status }));
  revalidatePath(`/bookings/${id}`);
  revalidatePath("/bookings");
}

export async function createReview(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const bookingId = String(formData.get("bookingId") ?? "");

  const result = await run(() =>
    gateway.reviews.create({
      bookingId,
      rating: Number(formData.get("rating")),
      comment: String(formData.get("comment") ?? "") || undefined,
    }),
  );

  if (result.error) return { error: result.error };

  revalidatePath(`/bookings/${bookingId}`);
  redirect(`/bookings/${bookingId}`);
}

export async function raiseDispute(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const bookingId = String(formData.get("bookingId") ?? "");

  const result = await run(() =>
    gateway.disputes.raise({
      bookingId,
      reason: String(formData.get("reason") ?? ""),
      details: String(formData.get("details") ?? ""),
    }),
  );

  if (result.error) return { error: result.error };

  revalidatePath(`/bookings/${bookingId}`);
  redirect(`/bookings/${bookingId}`);
}

export async function withdrawQuote(formData: FormData): Promise<void> {
  const id = String(formData.get("quoteId") ?? "");
  await run(() => gateway.quotes.withdraw({ id }));
  revalidatePath(`/quotes/${id}`);
}
