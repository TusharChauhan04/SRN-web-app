import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { repo } from "@/lib/repositories";
import {
  isProviderRole,
  type Booking,
  type User,
} from "@/lib/repositories/types";
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
 * Mobile has four separate dashboard screens (BusinessDashboard,
 * CustomerDashboard, DigitalProviderDashboard, LocalProviderDashboard) mounted
 * by four separate navigators. On web they share `/dashboard` and branch on
 * role, which keeps the nav config simple and means a role change doesn't
 * strand the user on a dead URL.
 */
export default async function DashboardPage() {
  const user = await requireUser();

  // Admin has its own section with a different information architecture.
  if (user.role === "admin") redirect("/admin");

  return isProviderRole(user.role) ? (
    <ProviderDashboard user={user} />
  ) : (
    <SeekerDashboard user={user} />
  );
}

// ─────────────── Business / customer (posts requirements) ───────────────

async function SeekerDashboard({ user }: { user: User }) {
  const [
    requirements,
    bookings,
    quotes,
    unreadMessages,
    openRequirementsPage,
    confirmedPage,
    inProgressPage,
  ] = await Promise.all([
    repo.requirements.list({ creatorId: user.id, limit: 5 }),
    repo.bookings.list({ customerId: user.id, limit: 5 }),
    repo.quotes.list({ receiverId: user.id, status: "pending", limit: 5 }),
    repo.messages.countUnread(user.id),
    // Headline stats need counts over ALL rows, not the 5-row page. Deriving
    // them by filtering `items` capped every stat at 5 — and read 0 whenever
    // the 5 most recent rows happened to be closed.
    repo.requirements.list({ creatorId: user.id, status: "open", limit: 1 }),
    repo.bookings.list({ customerId: user.id, status: "confirmed", limit: 1 }),
    repo.bookings.list({
      customerId: user.id,
      status: "in_progress",
      limit: 1,
    }),
  ]);

  // `Page.total` is optional by design — cursor-only stores can't supply it.
  // Fall back to the loaded page length so these counters never render blank.
  const requirementCount = requirements.total ?? requirements.items.length;
  const pendingQuoteCount = quotes.total ?? quotes.items.length;
  const openRequirements =
    openRequirementsPage.total ?? openRequirementsPage.items.length;
  const activeBookings =
    (confirmedPage.total ?? confirmedPage.items.length) +
    (inProgressPage.total ?? inProgressPage.items.length);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description={
          user.role === "business"
            ? "Your open requirements and incoming quotes."
            : "Your jobs, bookings, and quotes in one place."
        }
        action={
          <ButtonLink href="/requirements/new">Post a requirement</ButtonLink>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open requirements" value={openRequirements} />
        <Stat label="Pending quotes" value={pendingQuoteCount} />
        <Stat label="Active bookings" value={activeBookings} />
        <Stat label="Unread messages" value={unreadMessages} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Quotes awaiting your decision"
            action={
              pendingQuoteCount > 0 ? (
                <Link
                  href="/requirements"
                  className="text-sm text-[var(--primary)] hover:underline"
                >
                  View all
                </Link>
              ) : null
            }
          />
          {quotes.items.length === 0 ? (
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
              {quotes.items.map((quote) => (
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
              requirementCount > 0 ? (
                <Link
                  href="/requirements"
                  className="text-sm text-[var(--primary)] hover:underline"
                >
                  View all
                </Link>
              ) : null
            }
          />
          {requirements.items.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nothing posted yet"
                description="Describe what you need and providers will come to you."
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {requirements.items.map((req) => (
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
                      {formatCurrency(req.minBudget)}–
                      {formatCurrency(req.maxBudget)}
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
        <BookingsCard bookings={bookings.items} emptyHint="Accept a quote to create your first booking." />
      </div>
    </>
  );
}

// ─────────────── Digital / local provider (bids on work) ───────────────

async function ProviderDashboard({ user }: { user: User }) {
  const [feed, myQuotes, bookings, unreadMessages, analytics] =
    await Promise.all([
      repo.requirements.feedForProvider(user.id, { limit: 5 }),
      repo.quotes.list({ senderId: user.id, limit: 5 }),
      repo.bookings.list({ providerId: user.id, limit: 5 }),
      repo.messages.countUnread(user.id),
      repo.analytics.providerAnalytics(user.id, 30),
    ]);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description="Work matched to your skills, plus how your profile is performing."
        action={<ButtonLink href="/requirements">Find work</ButtonLink>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Profile views"
          value={analytics.profileViews}
          hint="Last 30 days"
        />
        <Stat
          label="Quote acceptance"
          value={`${Math.round(analytics.acceptanceRate * 100)}%`}
          hint={`${analytics.quotesAccepted} of ${analytics.quotesSent}`}
        />
        <Stat
          label="Total earnings"
          value={formatCurrency(analytics.totalEarnings)}
          hint={`${analytics.completedBookings} completed`}
        />
        <Stat label="Unread messages" value={unreadMessages} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Matched to your skills"
            description={
              user.skills.length > 0
                ? user.skills.slice(0, 4).join(", ")
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
          {feed.items.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No matching work right now"
                description={
                  user.skills.length === 0
                    ? "Add skills to your profile so we can match you to requirements."
                    : "Check back shortly — new requirements are posted daily."
                }
                action={
                  user.skills.length === 0 ? (
                    <ButtonLink href="/profile" size="sm">
                      Add skills
                    </ButtonLink>
                  ) : null
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {feed.items.map((req) => (
                <li key={req.id}>
                  <Link
                    href={`/requirements/${req.id}`}
                    className="block px-5 py-4 hover:bg-[var(--muted)]"
                  >
                    <p className="truncate text-sm font-medium">{req.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {formatCurrency(req.minBudget)}–
                      {formatCurrency(req.maxBudget)} · {req.category}
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
          {myQuotes.items.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No bids yet"
                description="Find a requirement that matches your skills and submit a quote."
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {myQuotes.items.map((quote) => (
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
          bookings={bookings.items}
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
