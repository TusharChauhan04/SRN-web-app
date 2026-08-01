/**
 * Payment provider abstraction.
 *
 * Razorpay is the intended production processor, but nothing outside this
 * directory may import the `razorpay` package or reference its field names.
 * Connecting the real thing later is: set PAYMENT_PROVIDER=razorpay, add three
 * keys, point the webhook at /api/v1/payments/webhook. No calling code changes.
 *
 * Two invariants every implementation must uphold, because they are what stop
 * a browser from granting itself a paid plan:
 *
 *  1. Orders are created SERVER-side. The amount comes from our own price list,
 *     never from the request body.
 *  2. Entitlement is granted ONLY from a verified webhook. A client saying
 *     "payment succeeded" is a claim, not evidence.
 */
import type { SubscriptionTier } from "@/lib/repositories/types";

/** Monthly price in the smallest currency unit (paise), mirroring mobile. */
export const TIER_PRICES_MINOR: Record<SubscriptionTier, number> = {
  free: 0,
  pro: 49900, // ₹499
  elite: 149900, // ₹1499
};

export const CURRENCY = "INR";

export interface CreatedOrder {
  /** Provider-side order id. Stored so the webhook can correlate. */
  orderId: string;
  amountMinor: number;
  currency: string;
  /**
   * Public key the browser needs to open checkout. Safe to expose — it is an
   * identifier, not a secret.
   */
  publicKey: string;
}

/** A payment event the provider has cryptographically vouched for. */
export interface VerifiedPaymentEvent {
  kind: "payment.captured" | "payment.failed" | "ignored";
  orderId: string | null;
  paymentId: string | null;
  amountMinor: number | null;
}

export interface PaymentProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  /** Public key for the browser, or null when checkout can't run. */
  readonly publicKey: string | null;

  createOrder(input: {
    tier: SubscriptionTier;
    userId: string;
    /** Amount is passed for the record but MUST be re-derived, never trusted. */
    amountMinor: number;
  }): Promise<CreatedOrder>;

  /**
   * Verifies a webhook's signature and normalises the payload.
   *
   * Must return `kind: "ignored"` rather than throwing for events we don't act
   * on, and must throw for a signature that does not verify.
   */
  verifyWebhook(rawBody: string, signature: string | null): VerifiedPaymentEvent;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
