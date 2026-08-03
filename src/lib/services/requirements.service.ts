import "server-only";

/**
 * Requirement and quote policy.
 *
 * Every function takes the acting `User` and enforces ownership itself. The
 * gateway has already established *that* the caller is authenticated; deciding
 * whether they may touch this particular row is this layer's job.
 */
import { repo } from "@/lib/repositories";
import { RepositoryConflictError } from "@/lib/repositories/authorize";
import { notify } from "./notify.service";
import {
  isProviderRole,
  isSeekerRole,
  type Quote,
  type Requirement,
  type RequirementStatus,
  type User,
} from "@/lib/repositories/types";
import { GatewayError } from "@/lib/gateway/types";

// ─────────────────────────── Requirements ───────────────────────────

export interface CreateRequirementInput {
  title: string;
  category: string;
  description: string;
  skillsNeeded?: string[];
  minBudget: number;
  maxBudget: number;
  location?: string;
}

export async function createRequirement(
  actor: User,
  input: CreateRequirementInput,
): Promise<Requirement> {
  // Providers bid on work; they do not post it. Mirrors mobile, where the
  // "post requirement" tab only exists for business and customer.
  if (!isSeekerRole(actor.role)) {
    throw GatewayError.forbidden(
      "Only businesses and customers can post requirements.",
    );
  }

  if (input.maxBudget < input.minBudget) {
    throw GatewayError.validation(
      "The maximum budget must be at least the minimum.",
    );
  }

  const requirement = await repo.requirements.create({
    creatorId: actor.id,
    ...input,
  });

  await repo.audit
    .record({
      actorId: actor.id,
      action: "requirement.created",
      target: requirement.id,
    })
    .catch(() => {});

  return requirement;
}

/** The caller's own requirements. */
export async function listMine(
  actor: User,
  filter: { status?: RequirementStatus; limit?: number; offset?: number } = {},
) {
  return repo.requirements.list({ ...filter, creatorId: actor.id });
}

/** Open requirements a provider can bid on, matched to their skills. */
export async function listOpenForProvider(
  actor: User,
  params: { limit?: number; offset?: number } = {},
) {
  if (!isProviderRole(actor.role)) {
    throw GatewayError.forbidden("Only providers can browse open work.");
  }
  return repo.requirements.feedForProvider(actor.id, params);
}

/** Every open requirement, unfiltered by skill — the "browse all" view. */
export async function listOpen(filter: {
  query?: string;
  category?: string;
  skills?: string[];
  minBudget?: number;
  maxBudget?: number;
  limit?: number;
  offset?: number;
}) {
  return repo.requirements.list({ ...filter, status: "open" });
}

export interface RequirementDetail {
  requirement: Requirement;
  /** Quotes, visible only to the owner or to the provider who wrote them. */
  quotes: Quote[];
  /**
   * How many bids exist in total, which is NOT `quotes.length` once there are
   * more than a page of them. The owner's view is paginated, so the page needs
   * the real count to say "showing 20 of 340" and to render the pager.
   */
  quotesTotal: number;
  /** Zero-based page of bids this response represents. */
  quotesOffset: number;
  /** Page size used, so the caller doesn't have to know the default. */
  quotesLimit: number;
  /** True when the caller posted this requirement. */
  isOwner: boolean;
  /** The caller's own quote, if they already bid. */
  myQuote: Quote | null;
  canBid: boolean;
}

/** Bids per page on the requirement detail screen. */
export const BIDS_PAGE_SIZE = 20;

/**
 * A requirement plus whatever the caller is allowed to see of its bids.
 *
 * Quote visibility is the important part: the owner sees every bid, a provider
 * sees only their own. Returning all quotes to any signed-in user would leak
 * competitors' pricing, which is commercially sensitive.
 */
export async function getRequirementDetail(
  actor: User,
  requirementId: string,
  bidsOffset = 0,
): Promise<RequirementDetail> {
  const requirement = await repo.requirements.findById(requirementId);
  if (!requirement) throw GatewayError.notFound("Requirement not found");

  const isOwner = requirement.creatorId === actor.id;

  if (isOwner) {
    /*
     * PAGINATED, with the true total alongside.
     *
     * The cap used to be a flat 100 with no total and no pager, so bid 101 was
     * simply invisible to the one person who must see every bid. Raising the
     * limit was not the fix: `normalizePageParams` clamps any request to
     * MAX_PAGE_LIMIT, so asking for more returned the same 100 rows — and
     * rendering thousands of bid cards on one page is its own problem. Real
     * paging is the answer, and `total` is what makes it honest.
     */
    const quotes = await repo.quotes.list({
      requirementId,
      limit: BIDS_PAGE_SIZE,
      offset: bidsOffset,
    });
    return {
      requirement,
      quotes: quotes.items,
      quotesTotal: quotes.total ?? quotes.items.length,
      quotesOffset: bidsOffset,
      quotesLimit: BIDS_PAGE_SIZE,
      isOwner: true,
      myQuote: null,
      canBid: false,
    };
  }

  const mine = await repo.quotes.list({
    requirementId,
    senderId: actor.id,
    limit: 1,
  });
  const myQuote = mine.items[0] ?? null;

  return {
    requirement,
    // Deliberately empty: a bidder must not see who else bid or for how much.
    quotes: myQuote ? [myQuote] : [],
    // A bidder is shown only their own bid, so there is nothing to page
    // through — and the real bid count is information they must not have.
    quotesTotal: myQuote ? 1 : 0,
    quotesOffset: 0,
    quotesLimit: BIDS_PAGE_SIZE,
    isOwner: false,
    myQuote,
    canBid:
      isProviderRole(actor.role) &&
      requirement.status === "open" &&
      myQuote === null,
  };
}

export async function updateRequirementStatus(
  actor: User,
  requirementId: string,
  status: RequirementStatus,
): Promise<Requirement> {
  const requirement = await repo.requirements.findById(requirementId);
  if (!requirement) throw GatewayError.notFound("Requirement not found");
  if (requirement.creatorId !== actor.id && actor.role !== "admin") {
    throw GatewayError.forbidden("This isn't your requirement.");
  }

  return repo.requirements.updateStatus(requirementId, status);
}

export async function deleteRequirement(
  actor: User,
  requirementId: string,
): Promise<void> {
  const requirement = await repo.requirements.findById(requirementId);
  if (!requirement) throw GatewayError.notFound("Requirement not found");
  if (requirement.creatorId !== actor.id && actor.role !== "admin") {
    throw GatewayError.forbidden("This isn't your requirement.");
  }
  // Guard against deleting work someone is already committed to.
  if (requirement.status === "in_progress") {
    throw GatewayError.conflict(
      "This requirement has work in progress. Cancel it instead.",
    );
  }

  await repo.requirements.delete(requirementId);
  await repo.audit
    .record({
      actorId: actor.id,
      action: "requirement.deleted",
      target: requirementId,
    })
    .catch(() => {});
}

// ─────────────────────────── Quotes ───────────────────────────

export interface SubmitQuoteInput {
  requirementId: string;
  amount: number;
  durationDays: number;
  message?: string;
}

export async function submitQuote(
  actor: User,
  input: SubmitQuoteInput,
): Promise<Quote> {
  if (!isProviderRole(actor.role)) {
    throw GatewayError.forbidden("Only providers can submit quotes.");
  }

  const requirement = await repo.requirements.findById(input.requirementId);
  if (!requirement) throw GatewayError.notFound("Requirement not found");
  if (requirement.status !== "open") {
    throw GatewayError.conflict("This requirement is no longer accepting bids.");
  }
  if (requirement.creatorId === actor.id) {
    throw GatewayError.forbidden("You can't bid on your own requirement.");
  }

  const already = await repo.quotes.existsForSenderOnRequirement(
    actor.id,
    input.requirementId,
  );
  if (already) {
    throw GatewayError.conflict("You've already bid on this requirement.");
  }

  let quote;
  try {
    quote = await repo.quotes.create({
      requirementId: input.requirementId,
      senderId: actor.id,
      receiverId: requirement.creatorId,
      amount: input.amount,
      durationDays: input.durationDays,
      message: input.message,
    });
  } catch (err) {
    // Lost the race against a concurrent submission from the same provider —
    // same outcome as the check above, just decided by the database.
    if (err instanceof RepositoryConflictError) {
      throw GatewayError.conflict(err.message);
    }
    throw err;
  }

  // Tell the owner. Best effort — a failed notification must not lose the bid.
  await notify({
      userId: requirement.creatorId,
      type: "quote_received",
      title: "New quote on your requirement",
      body: `${actor.name} quoted for "${requirement.title}".`,
      data: { requirementId: requirement.id, quoteId: quote.id },
    });

  return quote;
}

/** Quotes the caller sent (providers) or received (seekers). */
export async function listMyQuotes(
  actor: User,
  params: { limit?: number; offset?: number } = {},
) {
  return isProviderRole(actor.role)
    ? repo.quotes.list({ ...params, senderId: actor.id })
    : repo.quotes.list({ ...params, receiverId: actor.id });
}

/** A single quote — visible only to the two parties. */
export async function getQuote(actor: User, quoteId: string): Promise<Quote> {
  const quote = await repo.quotes.findById(quoteId);
  if (!quote) throw GatewayError.notFound("Quote not found");

  if (
    quote.senderId !== actor.id &&
    quote.receiverId !== actor.id &&
    actor.role !== "admin"
  ) {
    // notFound rather than forbidden: confirming the id exists would let
    // someone enumerate quotes.
    throw GatewayError.notFound("Quote not found");
  }

  return quote;
}

/** Shortlists a bid without committing to it. Owner only. */
export async function shortlistQuote(
  actor: User,
  quoteId: string,
): Promise<Quote> {
  const quote = await getQuote(actor, quoteId);
  if (quote.receiverId !== actor.id) {
    throw GatewayError.forbidden("Only the requirement owner can shortlist.");
  }

  const updated = await repo.quotes.shortlist(quote.requirementId, quoteId);

  await notify({
      userId: quote.senderId,
      type: "quote_shortlisted",
      title: "You've been shortlisted",
      body: `${actor.name} shortlisted your quote.`,
      data: { quoteId },
    });

  return updated;
}

export async function rejectQuote(
  actor: User,
  quoteId: string,
): Promise<Quote> {
  const quote = await getQuote(actor, quoteId);
  if (quote.receiverId !== actor.id) {
    throw GatewayError.forbidden("Only the requirement owner can reject.");
  }
  if (quote.status === "accepted") {
    throw GatewayError.conflict(
      "This quote is already accepted — cancel the booking instead.",
    );
  }
  return repo.quotes.updateStatus(quoteId, "rejected");
}

/** Withdraws the caller's own bid. Provider only. */
export async function withdrawQuote(
  actor: User,
  quoteId: string,
): Promise<Quote> {
  const quote = await getQuote(actor, quoteId);
  if (quote.senderId !== actor.id) {
    throw GatewayError.forbidden("This isn't your quote.");
  }
  if (quote.status === "accepted") {
    throw GatewayError.conflict(
      "This quote is already accepted — you can't withdraw it.",
    );
  }
  return repo.quotes.updateStatus(quoteId, "withdrawn");
}
