import "server-only";

/**
 * The single place a user gets told about something.
 *
 * Every service that wants to notify someone calls `notify()` rather than
 * writing a notification row directly. That matters for one reason: preferences.
 * With eleven scattered `repo.notifications.create` calls, honouring the user's
 * settings meant remembering to check them eleven times, and the email toggle
 * was already being ignored by all of them.
 *
 * Delivery is best effort by design. A notification is a side effect of
 * something that already happened — a bid submitted, a booking confirmed — and
 * failing that action because the notice could not be delivered would be worse
 * than the missed notice.
 */
import { repo } from "@/lib/repositories";
import { emailProvider } from "@/lib/providers/email/index.server";
import type { NotificationPrefs } from "@/lib/repositories/types";

/**
 * Which preference governs which notification type.
 *
 * Types absent from this map are always delivered — they are account-level
 * events (verification, subscription, disputes) that a user should not be able
 * to silence, because missing them has consequences.
 */
/**
 * Which preference toggle silences which notification.
 *
 * This map must cover every type that is NOT in `ALWAYS_ON` below. A type
 * missing from both was silently unsilenceable: `review_received` ignored the
 * user's settings entirely, while `booking_confirmed` sat here as a dead entry
 * for an event nothing emits. Both are the same drift, in opposite directions.
 *
 * There is no separate "reviews" toggle — mobile's preference screen offers
 * quotes / bookings / messages / marketing — so a review, which only ever
 * arises from a completed booking, is governed by `bookings`.
 */
const PREF_BY_TYPE: Record<string, keyof Omit<NotificationPrefs, "userId">> = {
  quote_received: "quotes",
  quote_shortlisted: "quotes",
  quote_accepted: "quotes",
  booking_completed: "bookings",
  review_received: "bookings",
  message: "messages",
};

/**
 * Types that deliberately ignore preferences.
 *
 * Account-level events: money, identity, and moderation. Someone who has turned
 * off "quotes" has not asked to stop hearing that their KYC was rejected or
 * that a dispute was opened against them.
 */
const ALWAYS_ON = new Set([
  "dispute_opened",
  "dispute_resolved",
  "verification_approved",
  "verification_rejected",
  "subscription_active",
]);

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export async function notify(input: NotifyInput): Promise<void> {
  try {
    const prefs = await repo.notifications.getPrefs(input.userId);

    const governing = PREF_BY_TYPE[input.type];
    if (!governing && !ALWAYS_ON.has(input.type)) {
      // Neither silenceable nor deliberately unconditional — a new type was
      // added without deciding. Loud in dev, still delivered in production.
      console.warn(
        `[notify] "${input.type}" is in neither PREF_BY_TYPE nor ALWAYS_ON; ` +
          "it will ignore the user's preferences. Add it to one of them.",
      );
    }
    const wantsInApp = governing ? prefs[governing] : true;
    if (!wantsInApp) return;

    await repo.notifications.create(input);

    if (!prefs.email) return;

    const user = await repo.users.findById(input.userId);
    // Anonymised accounts hold a placeholder address that must not be mailed.
    if (!user || user.email.endsWith("@invalid.local")) return;

    await emailProvider()
      .send({
        to: user.email,
        subject: input.title,
        body: `${input.body}\n\n— SRN`,
      })
      .catch((err) => {
        // The in-app notification already landed; email is the optional half.
        console.error("[notify] email delivery failed:", err);
      });
  } catch (err) {
    console.error(`[notify] could not notify ${input.userId}:`, err);
  }
}
