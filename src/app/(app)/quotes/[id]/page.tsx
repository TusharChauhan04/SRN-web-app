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
  formatRelative,
  humanize,
  statusTone,
} from "@/components/ui";
import { withdrawQuote } from "../../bookings/actions";
import { acceptQuote, rejectQuote, shortlistQuote } from "../../requirements/actions";

export const metadata = { title: "Quote — SRN" };

/** Ported from mobile src/screens/shared/QuoteDetailScreen.tsx. */
export default async function QuoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ id }, { error: actionError }] = await Promise.all([
    params,
    searchParams,
  ]);

  let quote;
  try {
    quote = await gateway.quotes.detail({ id });
  } catch (err) {
    if (err instanceof GatewayError && err.code === "not_found") notFound();
    throw err;
  }

  const isSender = quote.senderId === user.id;
  const isReceiver = quote.receiverId === user.id;
  const isOpen =
    quote.status === "pending" || quote.status === "shortlisted";

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
        title={isSender ? "Your quote" : `Quote from ${quote.sender?.name}`}
        description={quote.requirement?.title}
        action={
          <Badge tone={statusTone(quote.status)}>{humanize(quote.status)}</Badge>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">Amount</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatCurrency(quote.amount)}
                </p>
              </div>
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Delivery
                </p>
                <p className="text-lg font-medium">
                  {quote.durationDays} days
                </p>
              </div>
              {quote.requirement ? (
                <div>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Client budget
                  </p>
                  <p className="text-lg font-medium tabular-nums">
                    up to {formatCurrency(quote.requirement.maxBudget)}
                  </p>
                </div>
              ) : null}
            </div>

            {quote.message ? (
              <p className="mt-5 whitespace-pre-wrap rounded-xl nm-inset p-4 text-sm leading-relaxed">
                {quote.message}
              </p>
            ) : null}

            <p className="mt-4 text-xs text-[var(--muted-foreground)]">
              Submitted {formatRelative(quote.createdAt)}
            </p>
          </Card>

          {isReceiver && isOpen ? (
            <Card>
              <CardHeader
                title="Decide on this quote"
                description="Accepting creates a booking and rejects the other bids."
              />
              <div className="flex flex-wrap gap-3 p-5">
                <form action={acceptQuote}>
                  <input type="hidden" name="quoteId" value={id} />
                  <Button type="submit">Accept &amp; create booking</Button>
                </form>

                {quote.status !== "shortlisted" ? (
                  <form action={shortlistQuote}>
                    <input type="hidden" name="quoteId" value={id} />
                    <input
                      type="hidden"
                      name="requirementId"
                      value={quote.requirementId}
                    />
                    <Button type="submit" variant="outline">
                      Shortlist
                    </Button>
                  </form>
                ) : null}

                <form action={rejectQuote}>
                  <input type="hidden" name="quoteId" value={id} />
                  <input
                    type="hidden"
                    name="requirementId"
                    value={quote.requirementId}
                  />
                  <Button type="submit" variant="ghost">
                    Reject
                  </Button>
                </form>
              </div>
            </Card>
          ) : null}

          {isSender && isOpen ? (
            <Card>
              <CardHeader
                title="Manage your quote"
                description="Withdrawing removes it from the client's list."
              />
              <div className="p-5">
                <form action={withdrawQuote}>
                  <input type="hidden" name="quoteId" value={id} />
                  <Button type="submit" variant="outline">
                    Withdraw quote
                  </Button>
                </form>
              </div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-sm font-medium">
              {isSender ? "You quoted" : "Provider"}
            </h2>
            <div className="mt-3 flex items-center gap-3">
              <Avatar
                name={quote.sender?.name ?? "?"}
                src={quote.sender?.avatarUrl}
              />
              <div className="min-w-0">
                <p className="truncate font-medium">{quote.sender?.name}</p>
                <p className="truncate text-sm text-[var(--muted-foreground)]">
                  {quote.sender?.title}
                  {quote.sender?.rating
                    ? ` · ${quote.sender.rating.toFixed(1)}★`
                    : ""}
                </p>
              </div>
            </div>

            {!isSender ? (
              <div className="mt-4 space-y-2">
                <ButtonLink
                  variant="outline"
                  size="sm"
                  href={`/messages?to=${quote.senderId}`}
                  className="w-full"
                >
                  Message
                </ButtonLink>
                <ButtonLink
                  variant="ghost"
                  size="sm"
                  href={`/providers/${quote.senderId}`}
                  className="w-full"
                >
                  View profile
                </ButtonLink>
              </div>
            ) : null}
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-medium">Requirement</h2>
            <Link
              href={`/requirements/${quote.requirementId}`}
              className="mt-2 block text-sm text-[var(--primary)] hover:underline"
            >
              {quote.requirement?.title ?? "View requirement"}
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
