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
const PREF_BY_TYPE: Record<string, keyof Omit<NotificationPrefs, "userId">> = {
  quote_received: "quotes",
  quote_shortlisted: "quotes",
  quote_accepted: "quotes",
  booking_completed: "bookings",
  booking_confirmed: "bookings",
  message: "messages",
};

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
    // An account-level event has no governing preference and always goes out.
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
