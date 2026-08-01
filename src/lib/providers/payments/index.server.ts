import "server-only";

/**
 * Payment provider implementations and selection.
 *
 * `mock` makes the whole subscription flow — order, checkout, webhook, grant —
 * work end to end before Razorpay keys exist, so the code path that grants a
 * paid tier is genuinely exercised rather than stubbed.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SubscriptionTier } from "@/lib/repositories/types";
import {
  CURRENCY,
  PaymentProviderError,
  TIER_PRICES_MINOR,
  type CreatedOrder,
  type PaymentProvider,
  type VerifiedPaymentEvent,
} from "./types";

// ─────────────────────────── Mock ───────────────────────────

const MOCK_PUBLIC_KEY = "mock_key_local_dev";

function mockSecret(): string {
  return (
    process.env.MOCK_PAYMENT_SECRET ??
    ((globalThis as { __mockPaySecret?: string }).__mockPaySecret ??= randomUUID())
  );
}

/**
 * Signs a mock webhook body the same way Razorpay does, so the verification
 * path being exercised in development is the real one.
 */
export function signMockWebhook(rawBody: string): string {
  return createHmac("sha256", mockSecret()).update(rawBody).digest("hex");
}

class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  readonly isConfigured = true;
  readonly publicKey = MOCK_PUBLIC_KEY;

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "MockPaymentProvider must never run in production — it would grant " +
          "paid tiers without taking payment. Set PAYMENT_PROVIDER=razorpay.",
      );
    }
  }

  async createOrder(input: {
    tier: SubscriptionTier;
    userId: string;
  }): Promise<CreatedOrder> {
    return {
      orderId: `mock_order_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      // Re-derived from our own price list — never from the caller.
      amountMinor: TIER_PRICES_MINOR[input.tier],
      currency: CURRENCY,
      publicKey: MOCK_PUBLIC_KEY,
    };
  }

  verifyWebhook(
    rawBody: string,
    signature: string | null,
  ): VerifiedPaymentEvent {
    if (!signature) {
      throw new PaymentProviderError("Missing signature", "webhook/unsigned");
    }

    const expected = signMockWebhook(rawBody);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new PaymentProviderError(
        "Signature verification failed",
        "webhook/bad-signature",
      );
    }

    const parsed = JSON.parse(rawBody) as {
      event?: string;
      orderId?: string;
      paymentId?: string;
      amountMinor?: number;
    };

    if (parsed.event !== "payment.captured") {
      return { kind: "ignored", orderId: null, paymentId: null, amountMinor: null };
    }

    return {
      kind: "payment.captured",
      orderId: parsed.orderId ?? null,
      paymentId: parsed.paymentId ?? null,
      amountMinor: parsed.amountMinor ?? null,
    };
  }
}

// ─────────────────────────── Razorpay ───────────────────────────

/**
 * The real processor. Only this class knows Razorpay's field names and
 * signature scheme.
 *
 * NOTE: not exercised end to end yet — it needs test keys and a tunnelled
 * webhook. The mock provider covers the same contract in the meantime, and the
 * webhook route is identical for both. Flagged in WEB_MIGRATION_PLAN.md as
 * requiring human review before it handles real money.
 */
class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = "razorpay";

  get isConfigured(): boolean {
    return Boolean(
      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID &&
        process.env.RAZORPAY_KEY_SECRET &&
        process.env.RAZORPAY_WEBHOOK_SECRET,
    );
  }

  get publicKey(): string | null {
    return process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? null;
  }

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new PaymentProviderError(
        "Razorpay is not configured. Set NEXT_PUBLIC_RAZORPAY_KEY_ID, " +
          "RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.",
        "razorpay/not-configured",
      );
    }
  }

  async createOrder(input: {
    tier: SubscriptionTier;
    userId: string;
  }): Promise<CreatedOrder> {
    this.assertConfigured();

    // Imported lazily so the SDK is not loaded when the mock provider is used.
    const Razorpay = (await import("razorpay")).default;
    const client = new Razorpay({
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });

    // Amount comes from our own price list. A client-supplied amount would let
    // a browser buy an elite plan for ₹1.
    const amountMinor = TIER_PRICES_MINOR[input.tier];

    const order = await client.orders.create({
      amount: amountMinor,
      currency: CURRENCY,
      receipt: `sub_${input.userId}_${Date.now()}`,
      notes: { tier: input.tier, userId: input.userId },
    });

    return {
      orderId: order.id,
      amountMinor,
      currency: CURRENCY,
      publicKey: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
    };
  }

  verifyWebhook(
    rawBody: string,
    signature: string | null,
  ): VerifiedPaymentEvent {
    this.assertConfigured();

    if (!signature) {
      throw new PaymentProviderError("Missing signature", "webhook/unsigned");
    }

    // Razorpay signs the RAW body — parsing before verifying would let a
    // re-serialised payload pass with a valid signature over different bytes.
    const expected = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest("hex");

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new PaymentProviderError(
        "Signature verification failed",
        "webhook/bad-signature",
      );
    }

    const parsed = JSON.parse(rawBody) as {
      event?: string;
      payload?: {
        payment?: {
          entity?: { id?: string; order_id?: string; amount?: number };
        };
      };
    };

    const entity = parsed.payload?.payment?.entity;

    if (parsed.event !== "payment.captured") {
      return { kind: "ignored", orderId: null, paymentId: null, amountMinor: null };
    }

    return {
      kind: "payment.captured",
      orderId: entity?.order_id ?? null,
      paymentId: entity?.id ?? null,
      amountMinor: entity?.amount ?? null,
    };
  }
}

// ─────────────────────────── Selection ───────────────────────────

export type PaymentProviderName = "razorpay" | "mock";

export function configuredPaymentProviderName(): PaymentProviderName {
  const configured = process.env.PAYMENT_PROVIDER?.toLowerCase();
  if (configured === "razorpay" || configured === "mock") return configured;
  return process.env.NODE_ENV === "production" ? "razorpay" : "mock";
}

let cached: PaymentProvider | null = null;

export function paymentProvider(): PaymentProvider {
  if (cached) return cached;
  cached =
    configuredPaymentProviderName() === "razorpay"
      ? new RazorpayPaymentProvider()
      : new MockPaymentProvider();
  return cached;
}

export { PaymentProviderError, TIER_PRICES_MINOR, CURRENCY };
export type { PaymentProvider, CreatedOrder, VerifiedPaymentEvent };
