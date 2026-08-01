import Link from "next/link";
import { redirect } from "next/navigation";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { isProviderRole } from "@/lib/repositories/types";
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  formatCurrency,
  formatDate,
  humanize,
  statusTone,
} from "@/components/ui";

export const metadata = { title: "Bookings — SRN" };

/** Ported from mobile src/screens/customer/BookingsScreen.tsx. */
export default async function BookingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const page = await gateway.bookings.listMine({ limit: 50 });
  const isProvider = isProviderRole(user.role);

  return (
    <>
      <PageHeader
        title="Bookings"
        description={
          isProvider
            ? "Work you've been booked for."
            : "Providers you've booked, and the state of each job."
        }
      />

      {page.items.length === 0 ? (
        <EmptyState
          title="No bookings yet"
          description={
            isProvider
              ? "Win a bid and your bookings will appear here."
              : "Accept a quote on one of your requirements to create a booking."
          }
          action={
            isProvider ? (
              <ButtonLink href="/requirements" size="sm">
                Find work
              </ButtonLink>
            ) : (
              <ButtonLink href="/requirements/new" size="sm">
                Post a requirement
              </ButtonLink>
            )
          }
        />
      ) : (
        <ul className="space-y-3">
          {page.items.map((booking) => {
            // Show the OTHER party — who that is depends on which side you're on.
            const other = isProvider ? booking.customer : booking.provider;
            return (
              <li key={booking.id}>
                <Card className="transition hover:border-[var(--primary)]">
                  <Link
                    href={`/bookings/${booking.id}`}
                    className="flex flex-wrap items-center gap-4 p-5"
                  >
                    <Avatar name={other?.name ?? "?"} src={other?.avatarUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {booking.requirement?.title ?? "Direct booking"}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                        {isProvider ? "For" : "With"} {other?.name}
                        {booking.scheduledFor
                          ? ` · ${formatDate(booking.scheduledFor)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums">
                        {formatCurrency(booking.amount)}
                      </span>
                      <Badge tone={statusTone(booking.status)}>
                        {humanize(booking.status)}
                      </Badge>
                    </div>
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
