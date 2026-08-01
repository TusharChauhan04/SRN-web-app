import { notFound, redirect } from "next/navigation";
import { gateway, GatewayError } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { ReviewForm } from "./ReviewForm";

export const metadata = { title: "Leave a review — SRN" };

/** Ported from mobile src/screens/shared/ReviewScreen.tsx. */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;

  let booking;
  try {
    booking = await gateway.bookings.detail({ id });
  } catch (err) {
    if (err instanceof GatewayError && err.code === "not_found") notFound();
    throw err;
  }

  // The service enforces all of this too; redirecting avoids showing a form
  // that would only fail.
  if (booking.customerId !== user.id) redirect(`/bookings/${id}`);
  if (booking.status !== "completed") redirect(`/bookings/${id}`);
  if (booking.hasReview) redirect(`/bookings/${id}`);

  return (
    <>
      <PageHeader
        title="Leave a review"
        description={`How did ${booking.provider?.name ?? "the provider"} do?`}
      />
      <ReviewForm bookingId={id} />
    </>
  );
}
