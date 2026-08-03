import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { gateway, GatewayError, BIDS_PAGE_SIZE } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  formatCurrency,
  formatRelative,
  humanize,
  statusTone,
} from "@/components/ui";
import {
  acceptQuote,
  closeRequirement,
  rejectQuote,
  shortlistQuote,
} from "../actions";

export const metadata = { title: "Requirement — SRN" };

/**
 * Ported from mobile src/screens/shared/RequirementDetailScreen.tsx.
 *
 * The quote list is owner-only — a bidder sees just their own bid. That rule
 * lives in the service, so this page renders whatever it is given rather than
 * deciding visibility itself.
 */
export default async function RequirementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; bids?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ id }, { error: actionError, bids }] = await Promise.all([
    params,
    searchParams,
  ]);

  // 1-based in the URL because that is what a reader expects; the service
  // takes an offset.
  const bidsPage = Math.max(1, Number(bids) || 1);

  let data;
  try {
    data = await gateway.requirements.detail({
      id,
      bidsOffset: (bidsPage - 1) * BIDS_PAGE_SIZE,
    });
  } catch (err) {
    if (err instanceof GatewayError && err.code === "not_found") notFound();
    throw err;
  }

  const {
    requirement,
    quotes,
    quotesTotal,
    quotesOffset,
    isOwner,
    myQuote,
    canBid,
  } = data;

  const hasPrev = quotesOffset > 0;
  const hasNext = quotesOffset + quotes.length < quotesTotal;

  return (
    <>
      {actionError ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-[var(--destructive)] bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]"
        >
          {actionError}
        </p>
      ) : null}
      <PageHeader
        title={requirement.title}
        description={`${requirement.category}${requirement.location ? ` · ${requirement.location}` : ""} · posted ${formatRelative(requirement.createdAt)}`}
        action={
          canBid ? (
            <ButtonLink href={`/requirements/${id}/bid`}>Submit a quote</ButtonLink>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-lg font-semibold tabular-nums">
                {formatCurrency(requirement.minBudget)} –{" "}
                {formatCurrency(requirement.maxBudget)}
              </span>
              <Badge tone={statusTone(requirement.status)}>
                {humanize(requirement.status)}
              </Badge>
            </div>

            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
              {requirement.description}
            </p>

            {requirement.skillsNeeded.length > 0 ? (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {requirement.skillsNeeded.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            ) : null}
          </Card>

          {isOwner ? (
            <Card>
              <CardHeader
                title={`Quotes (${quotesTotal})`}
                description="Shortlist the ones you like, then accept one to create a booking."
              />
              {quotes.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No quotes yet"
                    description="Providers matched to your skills will see this and bid."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {quotes.map((quote) => (
                    <li key={quote.id} className="p-5">
                      <div className="flex flex-wrap items-start gap-3">
                        <Avatar
                          name={quote.sender?.name ?? "?"}
                          src={quote.sender?.avatarUrl}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/providers/${quote.senderId}`}
                              className="font-medium hover:underline"
                            >
                              {quote.sender?.name}
                            </Link>
                            <Badge tone={statusTone(quote.status)}>
                              {humanize(quote.status)}
                            </Badge>
                          </div>
                          <p className="text-sm text-[var(--muted-foreground)]">
                            {quote.sender?.title}
                            {quote.sender?.rating
                              ? ` · ${quote.sender.rating.toFixed(1)}★`
                              : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">
                            {formatCurrency(quote.amount)}
                          </p>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            {quote.durationDays} days
                          </p>
                        </div>
                      </div>

                      {quote.message ? (
                        <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[var(--muted)] p-3 text-sm">
                          {quote.message}
                        </p>
                      ) : null}

                      {quote.status !== "rejected" &&
                      quote.status !== "withdrawn" &&
                      requirement.status === "open" ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <form action={acceptQuote}>
                            <input type="hidden" name="quoteId" value={quote.id} />
                            <Button size="sm" type="submit">
                              Accept &amp; book
                            </Button>
                          </form>

                          {quote.status !== "shortlisted" ? (
                            <form action={shortlistQuote}>
                              <input type="hidden" name="quoteId" value={quote.id} />
                              <input type="hidden" name="requirementId" value={id} />
                              <Button size="sm" variant="outline" type="submit">
                                Shortlist
                              </Button>
                            </form>
                          ) : null}

                          <form action={rejectQuote}>
                            <input type="hidden" name="quoteId" value={quote.id} />
                            <input type="hidden" name="requirementId" value={id} />
                            <Button size="sm" variant="ghost" type="submit">
                              Reject
                            </Button>
                          </form>

                          <ButtonLink
                            size="sm"
                            variant="ghost"
                            href={`/providers/${quote.senderId}`}
                          >
                            View profile
                          </ButtonLink>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {hasPrev || hasNext ? (
                <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] p-4">
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Showing {quotesOffset + 1}&ndash;{quotesOffset + quotes.length} of{" "}
                    {quotesTotal}
                  </p>
                  <div className="flex gap-2">
                    {hasPrev ? (
                      <ButtonLink
                        size="sm"
                        variant="outline"
                        href={`/requirements/${id}?bids=${bidsPage - 1}`}
                      >
                        Previous
                      </ButtonLink>
                    ) : null}
                    {hasNext ? (
                      <ButtonLink
                        size="sm"
                        variant="outline"
                        href={`/requirements/${id}?bids=${bidsPage + 1}`}
                      >
                        Next
                      </ButtonLink>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </Card>
          ) : myQuote ? (
            <Card>
              <CardHeader title="Your quote" />
              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-lg font-semibold tabular-nums">
                    {formatCurrency(myQuote.amount)}
                  </span>
                  <Badge tone={statusTone(myQuote.status)}>
                    {humanize(myQuote.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {myQuote.durationDays} days · submitted{" "}
                  {formatRelative(myQuote.createdAt)}
                </p>
                {myQuote.message ? (
                  <p className="mt-3 whitespace-pre-wrap rounded-xl bg-[var(--muted)] p-3 text-sm">
                    {myQuote.message}
                  </p>
                ) : null}
                <div className="mt-4">
                  <ButtonLink
                    size="sm"
                    variant="outline"
                    href={`/quotes/${myQuote.id}`}
                  >
                    Manage quote
                  </ButtonLink>
                </div>
              </div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-sm font-medium">Posted by</h2>
            <div className="mt-3 flex items-center gap-3">
              <Avatar
                name={requirement.creator?.name ?? "?"}
                src={requirement.creator?.avatarUrl}
              />
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {requirement.creator?.name}
                </p>
                <p className="text-sm text-[var(--muted-foreground)]">
                  {isOwner ? "You" : "Requirement owner"}
                </p>
              </div>
            </div>

            {!isOwner ? (
              <div className="mt-4">
                <ButtonLink
                  variant="outline"
                  size="sm"
                  href={`/messages?to=${requirement.creatorId}`}
                  className="w-full"
                >
                  Message
                </ButtonLink>
              </div>
            ) : null}
          </Card>

          {isOwner && requirement.status === "open" ? (
            <Card className="p-5">
              <h2 className="text-sm font-medium">Manage</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Closing stops new quotes. Existing ones stay visible.
              </p>
              <form action={closeRequirement} className="mt-3">
                <input type="hidden" name="requirementId" value={id} />
                <Button variant="outline" size="sm" type="submit" className="w-full">
                  Close requirement
                </Button>
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
