import "server-only";

import { z } from "zod";
import { defineOperation } from "../core";
import * as svc from "@/lib/services/bookings.service";

const page = {
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
};

const bookingStatus = z.enum([
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "disputed",
]);

/** Turns an accepted bid into a commitment. The marketplace's hinge. */
export const acceptQuote = defineOperation({
  name: "bookings.acceptQuote",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ quoteId: z.string().min(1) }),
  handler: ({ quoteId }, { user }) => svc.acceptQuote(user, quoteId),
});

export const listMine = defineOperation({
  name: "bookings.listMine",
  kind: "query",
  access: "authenticated",
  input: z.object({ status: bookingStatus.optional(), ...page }),
  handler: (input, { user }) => svc.listMyBookings(user, input),
});

export const detail = defineOperation({
  name: "bookings.detail",
  kind: "query",
  access: "authenticated",
  input: z.object({ id: z.string().min(1) }),
  handler: ({ id }, { user }) => svc.getBooking(user, id),
});

export const setStatus = defineOperation({
  name: "bookings.setStatus",
  kind: "mutation",
  access: "authenticated",
  input: z.object({ id: z.string().min(1), status: bookingStatus }),
  handler: ({ id, status }, { user }) =>
    svc.updateBookingStatus(user, id, status),
});

// ─────────────────────────── Reviews ───────────────────────────

export const createReview = defineOperation({
  name: "reviews.create",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    bookingId: z.string().min(1),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional(),
  }),
  handler: (input, { user }) => svc.createReview(user, input),
});

export const listReviewsFor = defineOperation({
  name: "reviews.listFor",
  kind: "query",
  access: "authenticated",
  input: z.object({ subjectId: z.string().min(1), ...page }),
  handler: ({ subjectId, ...params }) => svc.listReviewsFor(subjectId, params),
});

// ─────────────────────────── Disputes ───────────────────────────

export const raiseDispute = defineOperation({
  name: "disputes.raise",
  kind: "mutation",
  access: "authenticated",
  input: z.object({
    bookingId: z.string().min(1),
    reason: z.string().trim().min(3).max(120),
    details: z.string().trim().min(20, "Explain what went wrong").max(5000),
    evidenceUrls: z.array(z.string().url().max(500)).max(10).optional(),
  }),
  handler: (input, { user }) => svc.raiseDispute(user, input),
});

export const listMyDisputes = defineOperation({
  name: "disputes.listMine",
  kind: "query",
  access: "authenticated",
  input: z.object(page),
  handler: (input, { user }) => svc.listMyDisputes(user, input),
});
