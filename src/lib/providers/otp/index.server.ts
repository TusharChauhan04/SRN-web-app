import "server-only";

/**
 * One-time-code delivery — the fourth provider abstraction, same shape as auth,
 * payments and storage.
 *
 * Mobile sent OTPs through its own backend (`/verify/phone/send`,
 * `/verify/phone/confirm`). We are not reusing that backend, so this is a fresh
 * decision, and it gets the same treatment: an interface, a working local
 * implementation, and a real one behind a config switch.
 *
 * The CODE ITSELF NEVER LEAVES THE SERVER. It is stored hashed with the phone
 * number, compared server-side, and the API returns only whether the attempt
 * succeeded. A provider that returned the code to the client would make the
 * whole exercise decorative.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export interface OtpProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  /**
   * Delivers `code` to `phone`.
   *
   * Returns a hint shown in the UI only when the provider cannot really send —
   * the dev provider uses it to surface the code, which is why it refuses to
   * run in production.
   */
  send(phone: string, code: string): Promise<{ devHint?: string }>;
}

/** Development provider: logs the code and shows it in the UI. */
class ConsoleOtpProvider implements OtpProvider {
  readonly name = "console";
  readonly isConfigured = true;

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ConsoleOtpProvider must never run in production — it reveals the " +
          "verification code to whoever requested it. Configure a real SMS " +
          "provider and set OTP_PROVIDER accordingly.",
      );
    }
  }

  async send(phone: string, code: string): Promise<{ devHint?: string }> {
    console.log(`[otp] would send "${code}" to ${phone}`);
    return { devHint: code };
  }
}

/**
 * Real SMS delivery.
 *
 * NOT wired up: no SMS account exists yet, and inventing one would be guessing
 * at a vendor. The interface is final and the call sites are done, so
 * connecting Twilio/MSG91/whatever is implementing `send` here plus setting
 * OTP_PROVIDER. Flagged in WEB_MIGRATION_PLAN.md rather than pretended.
 */
class SmsOtpProvider implements OtpProvider {
  readonly name = "sms";

  get isConfigured(): boolean {
    return Boolean(process.env.SMS_API_KEY && process.env.SMS_SENDER_ID);
  }

  async send(): Promise<{ devHint?: string }> {
    throw new Error(
      "No SMS provider is wired up yet. Run with OTP_PROVIDER=console for " +
        "local development, or implement SmsOtpProvider — the interface is final.",
    );
  }
}

export function configuredOtpProviderName(): "console" | "sms" {
  const configured = process.env.OTP_PROVIDER?.toLowerCase();
  if (configured === "sms" || configured === "console") return configured;
  return process.env.NODE_ENV === "production" ? "sms" : "console";
}

let cached: OtpProvider | null = null;

export function otpProvider(): OtpProvider {
  cached ??=
    configuredOtpProviderName() === "sms"
      ? new SmsOtpProvider()
      : new ConsoleOtpProvider();
  return cached;
}

// ─────────────────────────── Code handling ───────────────────────────

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

/** Cryptographically random, not Math.random. */
export function generateOtp(): string {
  let code = "";
  for (let i = 0; i < OTP_LENGTH; i++) code += randomInt(0, 10).toString();
  return code;
}

/**
 * Hashes a code bound to its phone number.
 *
 * Salted with the phone so a stolen hash can't be replayed against a different
 * number, and so two people receiving the same random code don't collide.
 */
export function hashOtp(phone: string, code: string): string {
  return createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

/** Constant-time comparison, so a wrong code leaks nothing through timing. */
export function verifyOtpHash(
  phone: string,
  code: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashOtp(phone, code));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
