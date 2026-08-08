import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { gateway, GatewayError } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  PageHeader,
  formatCurrency,
  formatDate,
  humanize,
  statusTone,
} from "@/components/ui";
import { setBookingStatus } from "../actions";

export const metadata = { title: "Booking — SRN" };

/** Ported from mobile src/screens/shared/BookingDetailScreen.tsx. */
export default async function BookingDetailPage({
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

  const isProvider = booking.providerId === user.id;
  const other = isProvider ? booking.customer : booking.provider;

  // Only the provider drives work status; either party may cancel.
  const canStart = isProvider && booking.status === "confirmed";
  const canComplete = isProvider && booking.status === "in_progress";
  const canCancel =
    booking.status === "confirmed" || booking.status === "in_progress";

  const canReview =
    !isProvider && booking.status === "completed" && !booking.hasReview;
  const canDispute =
    booking.status !== "cancelled" && booking.status !== "disputed";

  return (
    <>
      <PageHeader
        title={booking.requirement?.title ?? "Booking"}
        description={`Created ${formatDate(booking.createdAt)}`}
        action={
          <Badge tone={statusTone(booking.status)}>
            {humanize(booking.status)}
          </Badge>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Agreed amount
                </p>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatCurrency(booking.amount)}
                </p>
              </div>
              {booking.scheduledFor ? (
                <div className="text-right">
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Scheduled
                  </p>
                  <p className="font-medium">
                    {formatDate(booking.scheduledFor)}
                  </p>
                </div>
              ) : null}
              {booking.completedAt ? (
                <div className="text-right">
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Completed
                  </p>
                  <p className="font-medium">
                    {formatDate(booking.completedAt)}
                  </p>
                </div>
              ) : null}
            </div>

            {booking.requirementId ? (
              <div className="mt-5 border-t border-[var(--border)] pt-4">
                <Link
                  href={`/requirements/${booking.requirementId}`}
                  className="text-sm text-[var(--primary)] hover:underline"
                >
                  View the original requirement
                </Link>
              </div>
            ) : null}
          </Card>

          {booking.status === "disputed" ? (
            <Card className="outline-2 outline-[var(--destructive-text)] p-5">
              <h2 className="font-medium text-[var(--destructive-text)]">
                This booking is under dispute
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                An administrator is reviewing it. Work status can&apos;t change
                until it&apos;s resolved.
              </p>
            </Card>
          ) : null}

          {canStart || canComplete || canCancel ? (
            <Card>
              <CardHeader
                title="Update this booking"
                description={
                  isProvider
                    ? "Keep the customer informed as the work progresses."
                    : "You can cancel while the work hasn't finished."
                }
              />
              <div className="flex flex-wrap gap-3 p-5">
                {canStart ? (
                  <form action={setBookingStatus}>
                    <input type="hidden" name="bookingId" value={id} />
                    <input type="hidden" name="status" value="in_progress" />
                    <Button type="submit">Start work</Button>
                  </form>
                ) : null}

                {canComplete ? (
                  <form action={setBookingStatus}>
                    <input type="hidden" name="bookingId" value={id} />
                    <input type="hidden" name="status" value="completed" />
                    <Button type="submit">Mark complete</Button>
                  </form>
                ) : null}

                {canCancel ? (
                  <form action={setBookingStatus}>
                    <input type="hidden" name="bookingId" value={id} />
                    <input type="hidden" name="status" value="cancelled" />
                    <Button type="submit" variant="outline">
                      Cancel booking
                    </Button>
                  </form>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-sm font-medium">
              {isProvider ? "Customer" : "Provider"}
            </h2>
            <div className="mt-3 flex items-center gap-3">
              <Avatar name={other?.name ?? "?"} src={other?.avatarUrl} />
              <div className="min-w-0">
                <p className="truncate font-medium">{other?.name}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <ButtonLink
                variant="outline"
                size="sm"
                href={`/messages?to=${isProvider ? booking.customerId : booking.providerId}`}
                className="w-full"
              >
                Message
              </ButtonLink>
              {!isProvider ? (
                <ButtonLink
                  variant="ghost"
                  size="sm"
                  href={`/providers/${booking.providerId}`}
                  className="w-full"
                >
                  View profile
                </ButtonLink>
              ) : null}
            </div>
          </Card>

          {canReview ? (
            <Card className="p-5">
              <h2 className="text-sm font-medium">Leave a review</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Reviews are what make good providers findable.
              </p>
              <ButtonLink
                size="sm"
                href={`/bookings/${id}/review`}
                className="mt-3 w-full"
              >
                Write a review
              </ButtonLink>
            </Card>
          ) : null}

          {canDispute ? (
            <Card className="p-5">
              <h2 className="text-sm font-medium">Something wrong?</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Raise a dispute and an administrator will review it.
              </p>
              <ButtonLink
                variant="outline"
                size="sm"
                href={`/bookings/${id}/dispute`}
                className="mt-3 w-full"
              >
                Raise a dispute
              </ButtonLink>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
