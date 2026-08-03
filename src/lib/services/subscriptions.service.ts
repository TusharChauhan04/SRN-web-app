import "server-only";

/**
 * Subscription and payment policy — the money path.
 *
 * Two rules, and everything else follows from them:
 *
 *  1. The AMOUNT is never taken from the request. It is looked up from our own
 *     price list, server-side, every time.
 *  2. ENTITLEMENT is granted only by a signature-verified webhook. A browser
 *     saying "payment succeeded" is a claim, not evidence — and the mobile app
 *     works the same way, so this is parity, not new caution.
 */
import { repo } from "@/lib/repositories";
import { notify } from "./notify.service";
import { RepositoryConflictError } from "@/lib/repositories/authorize";
import {
  CURRENCY,
  TIER_PRICES_MINOR,
  paymentProvider,
  PaymentProviderError,
} from "@/lib/providers/payments/index.server";
import type { Subscription, SubscriptionTier, User } from "@/lib/repositories/types";
import { GatewayError } from "@/lib/gateway/types";

export interface PlanView {
  tier: SubscriptionTier;
  name: string;
  priceMinor: number;
  /** Rupees, for display. */
  price: number;
  features: string[];
  isCurrent: boolean;
}

const PLAN_COPY: Record<
  SubscriptionTier,
  { name: string; features: string[] }
> = {
  free: {
    name: "Free",
    features: [
      "Bid on open requirements",
      "Up to 3 portfolio items",
      "Standard search placement",
    ],
  },
  pro: {
    name: "Pro",
    features: [
      "Priority placement in search",
      "Unlimited portfolio items",
      "Provider analytics",
      "Verified badge eligibility",
    ],
  },
  elite: {
    name: "Elite",
    features: [
      "Everything in Pro",
      "Top placement in search",
      "Early access to new requirements",
      "Dedicated support",
    ],
  },
};

export interface SubscriptionView {
  current: Subscription | null;
  plans: PlanView[];
  /** Null when the payment provider can't run — checkout is hidden, not broken. */
  publicKey: string | null;
  providerName: string;
}

export async function getSubscriptionView(
  actor: User,
): Promise<SubscriptionView> {
  const current = await repo.subscriptions.findByUserId(actor.id);
  const provider = paymentProvider();
  const activeTier: SubscriptionTier = current?.tier ?? "free";

  return {
    current,
    plans: (Object.keys(TIER_PRICES_MINOR) as SubscriptionTier[]).map(
      (tier) => ({
        tier,
        name: PLAN_COPY[tier].name,
        priceMinor: TIER_PRICES_MINOR[tier],
        price: TIER_PRICES_MINOR[tier] / 100,
        features: PLAN_COPY[tier].features,
        isCurrent: tier === activeTier,
      }),
    ),
    publicKey: provider.isConfigured ? provider.publicKey : null,
    providerName: provider.name,
  };
}

export interface CheckoutOrder {
  orderId: string;
  amountMinor: number;
  currency: string;
  publicKey: string;
  tier: SubscriptionTier;
  /** Prefill for the checkout widget. */
  customerName: string;
  customerEmail: string;
}

export async function createCheckoutOrder(
  actor: User,
  tier: SubscriptionTier,
): Promise<CheckoutOrder> {
  if (tier === "free") {
    throw GatewayError.validation("The free plan doesn't need checkout.");
  }

  const provider = paymentProvider();
  if (!provider.isConfigured) {
    throw new GatewayError(
      "provider_error",
      "Payments aren't configured yet. Try again shortly.",
    );
  }

  const current = await repo.subscriptions.findByUserId(actor.id);
  if (current?.tier === tier && current.status === "active") {
    throw GatewayError.conflict(`You're already on the ${tier} plan.`);
  }

  let order;
  try {
    order = await provider.createOrder({
      tier,
      userId: actor.id,
      // Passed for the record; the provider re-derives it from the price list.
      amountMinor: TIER_PRICES_MINOR[tier],
    });
  } catch (err) {
    if (err instanceof PaymentProviderError) {
      console.error("[subscriptions] order creation failed", err);
      throw new GatewayError(
        "provider_error",
        "We couldn't start checkout. Please try again.",
      );
    }
    throw err;
  }

  // Record the order WITHOUT granting anything. The order row is what the
  // webhook resolves the paid-for tier from, so opening (or abandoning) a
  // checkout can never change what the user currently has.
  await repo.subscriptions.createOrder(
    actor.id,
    tier,
    order.orderId,
    order.amountMinor,
  );

  await repo.audit
    .record({
      actorId: actor.id,
      action: "subscription.checkout_started",
      target: order.orderId,
      metadata: { tier, amountMinor: order.amountMinor },
    })
    .catch(() => {});

  return {
    orderId: order.orderId,
    amountMinor: order.amountMinor,
    currency: order.currency ?? CURRENCY,
    publicKey: order.publicKey,
    tier,
    customerName: actor.name,
    customerEmail: actor.email,
  };
}

/**
 * Handles a payment webhook.
 *
 * Called from the webhook route AFTER signature verification. Not reachable
 * from the gateway, because there is no session behind it — the caller is the
 * payment provider, not a user.
 */
export async function applyVerifiedPayment(input: {
  orderId: string;
  paymentId: string;
  amountMinor: number | null;
}): Promise<{
  applied: boolean;
  reason?:
    | "already_applied"
    | "order_already_settled"
    | "unknown_order"
    | "amount_mismatch";
}> {
  /*
   * Two idempotency guards, because they catch different failures.
   *
   *  - by PAYMENT id: a provider retrying a webhook it believes failed.
   *    Razorpay explicitly may deliver the same event more than once.
   *  - by ORDER id: a duplicate or replayed webhook carrying a *different*
   *    payment id for an order that was already settled. Guarding only on
   *    payment id let the same order be granted twice, extending the paid
   *    period for free — caught by testing the replay rather than assuming it.
   */
  const byPayment = await repo.subscriptions.findOrderByPaymentId(
    input.paymentId,
  );
  if (byPayment) {
    return { applied: false, reason: "already_applied" };
  }

  const order = await repo.subscriptions.findOrderById(input.orderId);
  if (order?.razorpayPaymentId) {
    console.warn(
      `[subscriptions] order ${input.orderId} already settled by payment ` +
        `${order.razorpayPaymentId}; ignoring ${input.paymentId}`,
    );
    return { applied: false, reason: "order_already_settled" };
  }

  /*
   * Distinguish "we do not know this order" from "the write failed".
   *
   * Both used to return applied:false with reason "unknown_order", which the
   * webhook route answers with 200 — telling the provider it was handled. The
   * provider's retry schedule is the only safety net for a transient failure,
   * so swallowing one meant the customer was charged and never received the
   * tier. An unknown order genuinely should not be retried; anything else must.
   */
  if (!order) {
    console.warn(`[subscriptions] webhook for unknown order ${input.orderId}`);
    return { applied: false, reason: "unknown_order" };
  }

  // The amount is re-derived from our own price list, so a webhook claiming a
  // different figure means something is wrong upstream — do not grant on it.
  /*
   * The expected amount was frozen when the order was created, so a price
   * change while an order was open cannot retroactively make a completed
   * payment look wrong.
   */
  const expected = order.amountMinor;
  if (input.amountMinor !== null) {
    /*
     * Underpayment must never grant a tier.
     *
     * Razorpay binds the amount to the order today, so this is belt-and-braces
     * — but the enforcement currently lives ENTIRELY in the third party, and it
     * stops holding the moment partial_payment is enabled, a second provider is
     * added, or a price changes while orders are open. This is the last check
     * before an entitlement is granted, so it does the check itself.
     *
     * Overpayment is allowed through: the customer is not harmed, and refusing
     * would strand money that was genuinely received.
     */
    if (input.amountMinor < expected) {
      console.error(
        `[subscriptions] underpayment on ${input.orderId}: paid ` +
          `${input.amountMinor}, ${order.tier} costs ${expected}`,
      );
      return { applied: false, reason: "amount_mismatch" };
    }
  }

  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  let subscription;
  try {
    subscription = await repo.subscriptions.activateFromPayment(
      input.orderId,
      input.paymentId,
      periodEnd,
    );
  } catch (err) {
    /*
     * Lost the race to settle this order.
     *
     * The replay checks above are reads, so two simultaneous deliveries both
     * pass them; the conditional settle inside the transaction is what actually
     * decides. Losing it means the order IS settled, which is a decided
     * outcome — acknowledge it (200) rather than letting it become a 500 the
     * provider retries forever. Every other failure propagates, so a genuine
     * transient error still gets retried.
     */
    if (err instanceof RepositoryConflictError) {
      console.warn(
        `[subscriptions] concurrent settle lost for ${input.orderId}`,
      );
      return { applied: false, reason: "order_already_settled" };
    }
    throw err;
  }

  {
    await notify({
        userId: subscription.userId,
        type: "subscription_active",
        title: "Subscription active",
        body: `You're now on the ${subscription.tier} plan.`,
      });

    await repo.audit
      .record({
        actorId: subscription.userId,
        action: "subscription.activated",
        target: input.orderId,
        metadata: {
          tier: subscription.tier,
          paymentId: input.paymentId,
          amountMinor: input.amountMinor,
        },
      })
      .catch(() => {});

    return { applied: true };
  }
  // Anything thrown from here propagates deliberately: the webhook route turns
  // it into a non-2xx so the provider retries.
}

export async function cancelAtPeriodEnd(actor: User): Promise<Subscription> {
  const current = await repo.subscriptions.findByUserId(actor.id);
  if (!current || current.tier === "free") {
    throw GatewayError.conflict("You don't have a paid plan to cancel.");
  }

  const updated = await repo.subscriptions.cancelAtPeriodEnd(actor.id);

  await repo.audit
    .record({
      actorId: actor.id,
      action: "subscription.cancelled",
      target: current.id,
    })
    .catch(() => {});

  return updated;
}
