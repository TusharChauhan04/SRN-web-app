import { redirect } from "next/navigation";
import Link from "next/link";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { isProviderRole } from "@/lib/repositories/types";
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  formatCurrency,
  formatDate,
} from "@/components/ui";

export const metadata = { title: "Earnings — SRN" };

/** Ported from mobile src/screens/digital/EarningsScreen.tsx. */
export default async function EarningsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isProviderRole(user.role)) redirect("/dashboard");

  const earnings = await gateway.earnings.mine();

  return (
    <>
      <PageHeader
        title="Earnings"
        description="What you've been paid, and what's still in flight."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Total earned"
          value={formatCurrency(earnings.totalEarned)}
          hint="From completed bookings"
        />
        <Stat
          label="In progress"
          value={formatCurrency(earnings.pendingAmount)}
          hint="Committed but not yet complete"
        />
        <Stat label="Jobs completed" value={earnings.completedCount} />
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="Recent completed work" />
          {earnings.recent.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nothing completed yet"
                description="Finish a booking and it'll show up here."
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {earnings.recent.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/bookings/${item.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-[var(--muted)]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.title}</p>
                      <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                        {item.customerName}
                        {item.completedAt
                          ? ` · ${formatDate(item.completedAt)}`
                          : ""}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatCurrency(item.amount)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/*
        Payouts are not modelled — mobile doesn't have them either. Earnings are
        derived from completed bookings, so this is parity, not an omission.
      */}
      <p className="mt-4 text-sm text-[var(--muted-foreground)]">
        Figures are derived from completed bookings. Payout scheduling isn&apos;t
        part of the platform.
      </p>
    </>
  );
}
