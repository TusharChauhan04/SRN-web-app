import { redirect } from "next/navigation";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { isProviderRole } from "@/lib/repositories/types";
import {
  Card,
  CardHeader,
  PageHeader,
  Stat,
  formatCurrency,
} from "@/components/ui";

export const metadata = { title: "Analytics — SRN" };

/** Ported from mobile src/screens/shared/AnalyticsScreen.tsx. */
export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isProviderRole(user.role)) redirect("/dashboard");

  const analytics = await gateway.analytics.mine({ days: 30 });
  const peak = Math.max(1, ...analytics.profileViewsSeries.map((d) => d.count));

  return (
    <>
      <PageHeader
        title="Analytics"
        description="How your profile has performed over the last 30 days."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Profile views" value={analytics.profileViews} />
        <Stat
          label="Quote acceptance"
          value={`${Math.round(analytics.acceptanceRate * 100)}%`}
          hint={`${analytics.quotesAccepted} of ${analytics.quotesSent} quotes`}
        />
        <Stat
          label="Total earnings"
          value={formatCurrency(analytics.totalEarnings)}
          hint={`${analytics.completedBookings} completed`}
        />
        <Stat
          label="Average rating"
          value={
            analytics.averageRating > 0
              ? `${analytics.averageRating.toFixed(1)}★`
              : "—"
          }
        />
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader
            title="Profile views"
            description="Daily, last 30 days"
          />
          <div className="p-5">
            {/*
              A plain CSS bar chart rather than a charting library: one series,
              30 points, no interaction needed. Pulling in a chart dependency
              for this would cost more than it returns.
            */}
            <div
              className="flex h-40 items-end gap-1"
              role="img"
              aria-label={`Profile views per day over the last 30 days, peaking at ${peak}`}
            >
              {analytics.profileViewsSeries.map((day) => (
                <div
                  key={day.date}
                  className="group relative flex-1"
                  style={{ height: "100%" }}
                >
                  <div
                    className="absolute bottom-0 w-full rounded-t bg-[var(--primary)] opacity-80 transition group-hover:opacity-100"
                    style={{ height: `${(day.count / peak) * 100}%` }}
                  />
                  <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[var(--secondary)] px-1.5 py-0.5 text-xs text-[var(--secondary-foreground)] group-hover:block">
                    {day.count} on {day.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-2 flex justify-between text-xs text-[var(--muted-foreground)]">
              <span>{analytics.profileViewsSeries[0]?.date ?? ""}</span>
              <span>
                {analytics.profileViewsSeries[
                  analytics.profileViewsSeries.length - 1
                ]?.date ?? ""}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
