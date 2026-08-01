import { gateway } from "@/lib/gateway";
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  formatCurrency,
} from "@/components/ui";

export const metadata = { title: "Revenue — Admin — SRN" };

/** No mobile equivalent — /admin/stats/revenue existed with no screen. */
export default async function AdminRevenuePage() {
  const data = await gateway.admin.revenue();

  return (
    <>
      <PageHeader
        title="Revenue"
        description="Subscription income and marketplace volume."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Monthly recurring revenue"
          value={formatCurrency(data.totalMrr)}
          hint="From active subscriptions"
        />
        <Stat
          label="Booking volume"
          value={formatCurrency(data.bookingVolume)}
          hint="Total value of completed bookings"
        />
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="Subscriptions by plan"
            description="Active subscriptions only."
          />
          {data.byTier.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No active subscriptions"
                description="Nobody is on a paid plan yet."
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.byTier.map((row) => (
                <li
                  key={row.tier}
                  className="flex items-center justify-between px-5 py-4"
                >
                  <div>
                    <p className="font-medium capitalize">{row.tier}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {row.count} subscriber{row.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(row.mrr)}/mo
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/*
        Stated rather than implied: booking volume is gross value transacted
        between users, not platform income. The platform takes no commission in
        this model, so conflating the two would overstate revenue badly.
      */}
      <p className="mt-4 text-sm text-[var(--muted-foreground)]">
        Booking volume is the gross value transacted between users, not platform
        income. Only subscription MRR is revenue.
      </p>
    </>
  );
}
