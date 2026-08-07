import Link from "next/link";
import { gateway } from "@/lib/gateway";
import { ROLE_LABELS, type UserRole } from "@/lib/repositories/types";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";

export const metadata = { title: "Admin — SRN" };

/** Ported from mobile src/screens/dashboards/AdminDashboard.tsx. */
export default async function AdminOverviewPage() {
  const data = await gateway.admin.overview();

  const totalUsers = Object.values(data.users).reduce((a, b) => a + b, 0);
  const peak = Math.max(1, ...data.growth.map((d) => d.users));

  return (
    <>
      <PageHeader
        title="Admin"
        description="Platform health and anything waiting on a decision."
      />

      {/* Queues first — these are the things a person has to act on. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/disputes" className="block">
          <Card
            className={`p-5 transition hover:outline-2 hover:outline-[var(--primary)] ${
              data.openDisputes > 0 ? "outline-2 outline-[var(--destructive)]" : ""
            }`}
          >
            <p className="text-sm text-[var(--muted-foreground)]">
              Open disputes
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {data.openDisputes}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {data.openDisputes > 0 ? "Waiting on a decision" : "Nothing open"}
            </p>
          </Card>
        </Link>

        <Link href="/admin/verification" className="block">
          <Card
            className={`p-5 transition hover:outline-2 hover:outline-[var(--primary)] ${
              data.pendingVerifications > 0 ? "outline-2 outline-[var(--accent)]" : ""
            }`}
          >
            <p className="text-sm text-[var(--muted-foreground)]">
              Pending verifications
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {data.pendingVerifications}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {data.pendingVerifications > 0
                ? "Identity documents to review"
                : "Queue is clear"}
            </p>
          </Card>
        </Link>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Users"
          value={totalUsers}
          hint={`+${data.newUsersThisWeek} this week`}
        />
        <Stat
          label="Requirements"
          value={data.totalRequirements}
          hint={`+${data.newRequirementsThisWeek} this week`}
        />
        <Stat label="Quotes" value={data.totalQuotes} />
        <Stat label="Bookings" value={data.totalBookings} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Users by role" />
          <ul className="divide-y divide-[var(--border)]">
            {(Object.keys(data.users) as UserRole[]).map((role) => (
              <li
                key={role}
                className="flex items-center justify-between px-5 py-3"
              >
                <span className="text-sm">{ROLE_LABELS[role]}</span>
                <span className="font-medium tabular-nums">
                  {data.users[role]}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="New signups" description="Daily, last 30 days" />
          <div className="p-5">
            <div
              className="flex h-32 items-end gap-1"
              role="img"
              aria-label={`New signups per day over the last 30 days, peaking at ${peak}`}
            >
              {data.growth.map((day) => (
                <div key={day.date} className="group relative h-full flex-1">
                  <div
                    className="absolute bottom-0 w-full rounded-t bg-[var(--accent)] opacity-80 transition group-hover:opacity-100"
                    style={{ height: `${(day.users / peak) * 100}%` }}
                  />
                  <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[var(--secondary)] px-1.5 py-0.5 text-xs text-[var(--secondary-foreground)] group-hover:block">
                    {day.users} on {day.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
