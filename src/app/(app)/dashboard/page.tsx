import { redirect } from "next/navigation";
import Link from "next/link";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import type {
  ProviderDashboard,
  SeekerDashboard,
} from "@/lib/services/dashboard.service";
import type { Booking } from "@/lib/repositories/types";
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  formatCurrency,
  formatRelative,
  humanize,
  statusTone,
} from "@/components/ui";

export const metadata = { title: "Dashboard — SRN" };

/**
 * One route, four dashboards.
 *
 * Mobile has four separate dashboard screens mounted by four separate
 * navigators. On web they share `/dashboard` and branch on the shape the
 * gateway returns, so a role change never strands the user on a dead URL.
 *
 * Note this page contains no data access of its own — it renders what the
 * gateway hands back. All aggregation lives in dashboard.service.
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Admin has its own section with a different information architecture.
  if (user.role === "admin") redirect("/admin");

  const data = await gateway.dashboard.get();
  const firstName = user.name.split(" ")[0];

  return data.kind === "seeker" ? (
    <SeekerView data={data} firstName={firstName} isBusiness={user.role === "business"} />
  ) : (
    <ProviderView data={data} firstName={firstName} skills={user.skills} />
  );
}

// ─────────────── Business / customer (posts requirements) ───────────────

function SeekerView({
  data,
  firstName,
  isBusiness,
}: {
  data: SeekerDashboard;
  firstName: string;
  isBusiness: boolean;
}) {
  const { stats } = data;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={
          isBusiness
            ? "Your open requirements and incoming quotes."
            : "Your jobs, bookings, and quotes in one place."
        }
        action={<ButtonLink href="/requirements/new">Post a requirement</ButtonLink>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open requirements" value={stats.openRequirements} />
        <Stat label="Pending quotes" value={stats.pendingQuotes} />
        <Stat label="Active bookings" value={stats.activeBookings} />
        <Stat label="Unread messages" value={stats.unreadMessages} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Quotes awaiting your decision"
            action={
              stats.pendingQuotes > 0 ? (
                <Link
                  href="/requirements"
                  className="text-sm text-[var(--primary)] hover:underline"
                >
                  View all
                </Link>
              ) : null
            }
          />
          {data.quotes.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No quotes yet"
                description="Providers will start bidding once you post a requirement."
                action={
                  <ButtonLink href="/requirements/new" size="sm">
                    Post a requirement
                  </ButtonLink>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.quotes.map((quote) => (
                <li key={quote.id}>
                  <Link
                    href={`/quotes/${quote.id}`}
                    className="flex items-center gap-3 px-5 py-4 hover:bg-[var(--muted)]"
                  >
                    <Avatar
                      name={quote.sender?.name ?? "?"}
                      src={quote.sender?.avatarUrl}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {quote.sender?.name}
                      </p>
                      <p className="truncate text-sm text-[var(--muted-foreground)]">
                        {quote.requirement?.title}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatCurrency(quote.amount)}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {quote.durationDays}d
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Your requirements"
            action={
              data.requirementCount > 0 ? (
                <Link
                  href="/requirements"
                  className="text-sm text-[var(--primary)] hover:underline"
                >
                  View all
                </Link>
              ) : null
            }
          />
          {data.requirements.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nothing posted yet"
                description="Describe what you need and providers will come to you."
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.requirements.map((req) => (
                <li key={req.id}>
                  <Link
                    href={`/requirements/${req.id}`}
                    className="block px-5 py-4 hover:bg-[var(--muted)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">
                        {req.title}
                      </p>
                      <Badge tone={statusTone(req.status)}>
                        {humanize(req.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {formatCurrency(req.minBudget)}–{formatCurrency(req.maxBudget)}
                      {req.quoteCount !== undefined
                        ? ` · ${req.quoteCount} quote${req.quoteCount === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <BookingsCard
          bookings={data.bookings}
          emptyHint="Accept a quote to create your first booking."
        />
      </div>
    </>
  );
}

// ─────────────── Digital / local provider (bids on work) ───────────────

function ProviderView({
  data,
  firstName,
  skills,
}: {
  data: ProviderDashboard;
  firstName: string;
  skills: string[];
}) {
  const { stats } = data;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Work matched to your skills, plus how your profile is performing."
        action={<ButtonLink href="/requirements">Find work</ButtonLink>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Profile views" value={stats.profileViews} hint="Last 30 days" />
        <Stat
          label="Quote acceptance"
          value={`${Math.round(stats.acceptanceRate * 100)}%`}
          hint={`${stats.quotesAccepted} of ${stats.quotesSent}`}
        />
        <Stat
          label="Total earnings"
          value={formatCurrency(stats.totalEarnings)}
          hint={`${stats.completedBookings} completed`}
        />
        <Stat label="Unread messages" value={stats.unreadMessages} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Matched to your skills"
            description={
              skills.length > 0
                ? skills.slice(0, 4).join(", ")
                : "Add skills to your profile for better matches"
            }
            action={
              <Link
                href="/requirements"
                className="text-sm text-[var(--primary)] hover:underline"
              >
                View all
              </Link>
            }
          />
          {data.feed.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No matching work right now"
                description={
                  skills.length === 0
                    ? "Add skills to your profile so we can match you to requirements."
                    : "Check back shortly — new requirements are posted daily."
                }
                action={
                  skills.length === 0 ? (
                    <ButtonLink href="/profile" size="sm">
                      Add skills
                    </ButtonLink>
                  ) : null
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.feed.map((req) => (
                <li key={req.id}>
                  <Link
                    href={`/requirements/${req.id}`}
                    className="block px-5 py-4 hover:bg-[var(--muted)]"
                  >
                    <p className="truncate text-sm font-medium">{req.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {formatCurrency(req.minBudget)}–{formatCurrency(req.maxBudget)} ·{" "}
                      {req.category}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Posted {formatRelative(req.createdAt)}
                      {req.quoteCount !== undefined
                        ? ` · ${req.quoteCount} bid${req.quoteCount === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Your recent bids" />
          {data.quotes.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No bids yet"
                description="Find a requirement that matches your skills and submit a quote."
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.quotes.map((quote) => (
                <li key={quote.id}>
                  <Link
                    href={`/quotes/${quote.id}`}
                    className="flex items-start justify-between gap-3 px-5 py-4 hover:bg-[var(--muted)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {quote.requirement?.title ?? "Requirement"}
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                        {formatCurrency(quote.amount)} · {quote.durationDays}d
                      </p>
                    </div>
                    <Badge tone={statusTone(quote.status)}>
                      {humanize(quote.status)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <BookingsCard
          bookings={data.bookings}
          emptyHint="Win a bid and your bookings will appear here."
        />
      </div>
    </>
  );
}

// ─────────────── Shared ───────────────

function BookingsCard({
  bookings,
  emptyHint,
}: {
  bookings: Booking[];
  emptyHint: string;
}) {
  return (
    <Card>
      <CardHeader
        title="Recent bookings"
        action={
          bookings.length > 0 ? (
            <Link
              href="/bookings"
              className="text-sm text-[var(--primary)] hover:underline"
            >
              View all
            </Link>
          ) : null
        }
      />
      {bookings.length === 0 ? (
        <div className="p-5">
          <EmptyState title="No bookings yet" description={emptyHint} />
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {bookings.map((booking) => (
            <li key={booking.id}>
              <Link
                href={`/bookings/${booking.id}`}
                className="flex items-center gap-3 px-5 py-4 hover:bg-[var(--muted)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {booking.requirement?.title ?? "Direct booking"}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">
                    {booking.provider?.name} · {booking.customer?.name}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(booking.amount)}
                </span>
                <Badge tone={statusTone(booking.status)}>
                  {humanize(booking.status)}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
