import { notFound, redirect } from "next/navigation";
import { gateway, GatewayError } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { Alert, PageHeader } from "@/components/ui";
import { DisputeForm } from "./DisputeForm";

export const metadata = { title: "Raise a dispute — SRN" };

/** Ported from mobile src/screens/shared/DisputeScreen.tsx. */
export default async function DisputePage({
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

  if (booking.status === "cancelled" || booking.status === "disputed") {
    redirect(`/bookings/${id}`);
  }

  return (
    <>
      <PageHeader
        title="Raise a dispute"
        description={booking.requirement?.title ?? "Booking"}
      />

      <div className="mb-6">
        <Alert tone="warning">
          Raising a dispute pauses this booking and notifies the other party. An
          administrator will review both sides. Try messaging them first — most
          problems resolve faster that way.
        </Alert>
      </div>

      <DisputeForm bookingId={id} />
    </>
  );
}
