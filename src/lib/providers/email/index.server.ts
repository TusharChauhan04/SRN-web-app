import "server-only";

/**
 * Email delivery — the fifth and last provider abstraction, same shape as auth,
 * payments, storage and OTP.
 *
 * This exists because the settings screen offers an "email me these" toggle and
 * nothing was sending email. A switch that silently does nothing is worse than
 * no switch: the user believes they have configured something.
 *
 * Mobile's backend had an `emailService.ts` and an `email_queue` table, so this
 * is parity rather than scope creep.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text. Deliberately not HTML — see the note in the console provider. */
  body: string;
}

export interface EmailProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development provider: logs instead of sending.
 *
 * Bodies are plain text throughout. HTML email means escaping user-supplied
 * content correctly in a second templating language, and an notification email
 * that renders someone's message text is a real injection surface. Plain text
 * removes that problem entirely, and these are short transactional notices.
 */
class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  readonly isConfigured = true;

  constructor() {
    /*
     * Refuse to exist in production, matching the other development providers.
     *
     * Preflight only warns about this, and the warning understates it: these
     * bodies carry notification content — someone's message text, quote
     * amounts, dispute details — straight into the server log, where log
     * shipping and retention were never designed to hold personal data.
     */
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "The console email provider cannot be used in production: it writes " +
          "notification bodies to the server log instead of sending them. " +
          "Configure EMAIL_PROVIDER and a real mail vendor.",
      );
    }
  }

  async send(message: EmailMessage): Promise<void> {
    console.log(
      `[email] to=${message.to} subject="${message.subject}"\n${message.body}`,
    );
  }
}

/**
 * Real delivery.
 *
 * NOT wired up: no mail account exists, and picking a vendor is not a decision
 * to make by guessing. The interface is final and the call site is done, so
 * connecting SES/Resend/Postmark is implementing `send` plus setting
 * EMAIL_PROVIDER. Recorded in WEB_MIGRATION_PLAN.md.
 */
class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";

  get isConfigured(): boolean {
    return Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
  }

  async send(): Promise<void> {
    throw new Error(
      "No email provider is wired up yet. Run with EMAIL_PROVIDER=console for " +
        "local development, or implement SmtpEmailProvider — the interface is final.",
    );
  }
}

export function configuredEmailProviderName(): "console" | "smtp" {
  const configured = process.env.EMAIL_PROVIDER?.toLowerCase();
  if (configured === "smtp" || configured === "console") return configured;
  return process.env.NODE_ENV === "production" ? "smtp" : "console";
}

let cached: EmailProvider | null = null;

export function emailProvider(): EmailProvider {
  cached ??=
    configuredEmailProviderName() === "smtp"
      ? new SmtpEmailProvider()
      : new ConsoleEmailProvider();
  return cached;
}
