import "server-only";

/**
 * Booking, review and dispute policy.
 *
 * Accepting a quote is the hinge of the whole marketplace: it turns a bid into
 * a commitment, closes the requirement, and rejects the losing bids. That
 * sequence lives here rather than in a page so it can't be half-performed.
 */
import { repo } from "@/lib/repositories";
import { notify } from "./notify.service";
import { RepositoryConflictError } from "@/lib/repositories/authorize";
import type {
  Booking,
  BookingStatus,
  Dispute,
  Review,
  User,
} from "@/lib/repositories/types";
import { GatewayError } from "@/lib/gateway/types";

/** Statuses a booking may still legally move to, by current status. */
const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  confirmed: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  // Terminal or externally controlled.
  completed: [],
  cancelled: [],
  disputed: [],
};

export async function acceptQuote(
  actor: User,
  quoteId: string,
): Promise<Booking> {
  const quote = await repo.quotes.findById(quoteId);
  if (!quote) throw GatewayError.notFound("Quote not found");
  if (quote.receiverId !== actor.id) {
    throw GatewayError.forbidden("Only the requirement owner can accept.");
  }
  if (quote.status === "accepted") {
    throw GatewayError.conflict("This quote has already been accepted.");
  }
  if (quote.status === "withdrawn" || quote.status === "rejected") {
    throw GatewayError.conflict(`This quote was ${quote.status}.`);
  }

  const requirement = await repo.requirements.findById(quote.requirementId);
  // A null requirement used to skip the status check entirely and book anyway.
  if (!requirement) throw GatewayError.notFound("Requirement not found");
  if (requirement.status !== "open") {
    throw GatewayError.conflict(
      "This requirement already has an accepted quote.",
    );
  }

  /*
   * The four writes happen atomically in the repository, and the requirement
   * claim inside it is the real concurrency gate — the check above is a fast
   * path for the common case, not the guard. Accepting two different bids in
   * the same instant previously produced two bookings and two committed
   * providers, and a failure partway left an orphan booking that made the
   * quote permanently unacceptable.
   */
  let booking: Booking;
  try {
    booking = await repo.bookings.createFromAcceptedQuote({
      quoteId: quote.id,
      requirementId: quote.requirementId,
      customerId: actor.id,
      providerId: quote.senderId,
      amount: quote.amount,
    });
  } catch (err) {
    if (err instanceof RepositoryConflictError) {
      throw GatewayError.conflict(err.message);
    }
    throw err;
  }

  await notify({
    userId: quote.senderId,
    type: "quote_accepted",
    title: "Your quote was accepted",
    body: `${actor.name} accepted your quote. The booking is confirmed.`,
    data: { bookingId: booking.id },
  });

  await repo.audit
    .record({
      actorId: actor.id,
      action: "booking.created",
      target: booking.id,
      metadata: { quoteId: quote.id, amount: quote.amount },
    })
    .catch(() => {});

  return booking;
}

export async function listMyBookings(
  actor: User,
  filter: { status?: BookingStatus; limit?: number; offset?: number } = {},
) {
  // A user can be on either side, so query by whichever role they hold.
  const asProvider = actor.role === "digital" || actor.role === "local";
  return repo.bookings.list(
    asProvider
      ? { ...filter, providerId: actor.id }
      : { ...filter, customerId: actor.id },
  );
}

/** A booking, visible only to its two parties. */
export async function getBooking(
  actor: User,
  bookingId: string,
): Promise<Booking> {
  const booking = await repo.bookings.findById(bookingId);
  if (!booking) throw GatewayError.notFound("Booking not found");

  if (
    booking.customerId !== actor.id &&
    booking.providerId !== actor.id &&
    actor.role !== "admin"
  ) {
    throw GatewayError.notFound("Booking not found");
  }
  return booking;
}

export async function updateBookingStatus(
  actor: User,
  bookingId: string,
  status: BookingStatus,
): Promise<Booking> {
  const booking = await getBooking(actor, bookingId);

  if (!ALLOWED_TRANSITIONS[booking.status].includes(status)) {
    throw GatewayError.conflict(
      `A ${booking.status} booking can't move to ${status}.`,
    );
  }

  // Only the provider marks work started or finished; either party may cancel.
  if (status !== "cancelled" && booking.providerId !== actor.id) {
    throw GatewayError.forbidden("Only the provider can update work status.");
  }

  const updated = await repo.bookings.updateStatus(bookingId, status);

  if (booking.requirementId) {
    if (status === "completed") {
      await repo.requirements
        .updateStatus(booking.requirementId, "closed")
        .catch(() => {});
    } else if (status === "cancelled") {
      // Reopen rather than strand it. A cancelled booking used to leave the
      // requirement in_progress permanently — no new bids, not deletable, and
      // only a manual status change recovered it.
      await repo.requirements
        .updateStatus(booking.requirementId, "open")
        .catch(() => {});
    }
  }

  if (status === "completed") {
    await notify({
        userId: booking.customerId,
        type: "booking_completed",
        title: "Booking completed",
        body: "Your booking is marked complete. Leave a review?",
        data: { bookingId },
      });
  }

  return updated;
}

// ─────────────────────────── Reviews ───────────────────────────

export async function createReview(
  actor: User,
  input: { bookingId: string; rating: number; comment?: string },
): Promise<Review> {
  const booking = await getBooking(actor, input.bookingId);

  if (booking.customerId !== actor.id) {
    throw GatewayError.forbidden("Only the customer can review a booking.");
  }
  if (booking.status !== "completed") {
    throw GatewayError.conflict("You can only review a completed booking.");
  }

  const existing = await repo.reviews.findByBookingId(input.bookingId);
  if (existing) {
    throw GatewayError.conflict("You've already reviewed this booking.");
  }

  const review = await repo.reviews.create({
    bookingId: input.bookingId,
    authorId: actor.id,
    subjectId: booking.providerId,
    rating: input.rating,
    comment: input.comment,
  });

  await notify({
      userId: booking.providerId,
      type: "review_received",
      title: "New review",
      body: `${actor.name} left you a ${input.rating}-star review.`,
      data: { bookingId: input.bookingId },
    });

  return review;
}

export async function listReviewsFor(
  subjectId: string,
  params: { limit?: number; offset?: number } = {},
) {
  return repo.reviews.list({ ...params, subjectId });
}

// ─────────────────────────── Disputes ───────────────────────────

export async function raiseDispute(
  actor: User,
  input: {
    bookingId: string;
    reason: string;
    details: string;
    evidenceUrls?: string[];
  },
): Promise<Dispute> {
  const booking = await getBooking(actor, input.bookingId);

  if (booking.status === "cancelled") {
    throw GatewayError.conflict("This booking was cancelled.");
  }

  const dispute = await repo.disputes.create({
    bookingId: input.bookingId,
    raisedById: actor.id,
    reason: input.reason,
    details: input.details,
    evidenceUrls: input.evidenceUrls,
  });

  // Tell the other party, whoever that is relative to the raiser.
  const otherParty =
    booking.customerId === actor.id ? booking.providerId : booking.customerId;
  await notify({
      userId: otherParty,
      type: "dispute_opened",
      title: "A dispute was raised",
      body: `${actor.name} raised a dispute on your booking.`,
      data: { bookingId: input.bookingId, disputeId: dispute.id },
    });

  await repo.audit
    .record({
      actorId: actor.id,
      action: "dispute.raised",
      target: dispute.id,
      metadata: { bookingId: input.bookingId },
    })
    .catch(() => {});

  return dispute;
}

export async function listMyDisputes(
  actor: User,
  params: { limit?: number; offset?: number } = {},
) {
  return repo.disputes.list({ ...params, raisedById: actor.id });
}
