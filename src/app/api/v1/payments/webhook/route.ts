/**
 * Payment webhook — the only path that grants a paid tier.
 *
 * Deliberately NOT a gateway operation: there is no session behind it. The
 * caller is the payment provider, and the signature IS the authentication.
 *
 * Order of operations matters and is not negotiable:
 *   1. read the RAW body (parsing first would let a re-serialised payload pass
 *      a signature computed over different bytes)
 *   2. verify the signature
 *   3. only then act
 */
import { NextResponse } from "next/server";
import {
  PaymentProviderError,
  paymentProvider,
} from "@/lib/providers/payments/index.server";
import { applyVerifiedPayment } from "@/lib/services/subscriptions.service";

export const dynamic = "force-dynamic";

/** Header each provider signs with. */
const SIGNATURE_HEADERS = ["x-razorpay-signature", "x-mock-signature"];

export async function POST(req: Request) {
  // Raw text, before any parsing.
  const rawBody = await req.text();

  const signature =
    SIGNATURE_HEADERS.map((h) => req.headers.get(h)).find(Boolean) ?? null;

  let event;
  try {
    event = paymentProvider().verifyWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof PaymentProviderError) {
      // 400, not 500: the request is bad, and the provider should not retry a
      // payload it signed wrongly.
      console.warn("[payments/webhook] rejected:", err.code);
      return NextResponse.json(
        { error: { code: "invalid_signature", message: "Rejected" } },
        { status: 400 },
      );
    }
    console.error("[payments/webhook] verification error", err);
    return NextResponse.json(
      { error: { code: "internal", message: "Error" } },
      { status: 500 },
    );
  }

  // Events we don't act on still get a 200, or the provider retries forever.
  if (event.kind !== "payment.captured" || !event.orderId || !event.paymentId) {
    return NextResponse.json({ received: true, applied: false });
  }

  let result;
  try {
    result = await applyVerifiedPayment({
      orderId: event.orderId,
      paymentId: event.paymentId,
      amountMinor: event.amountMinor,
    });
  } catch (err) {
    /*
     * 500 ON PURPOSE, so the provider retries.
     *
     * The customer has already been charged at this point. The provider's retry
     * schedule is the only thing that recovers a transient failure here, and
     * answering 200 would discard it — leaving someone paid-up with no plan.
     * Decided cases (unknown order, replay, mismatch) return normally below and
     * are acknowledged.
     */
    console.error("[payments/webhook] failed to apply a captured payment", err);
    return NextResponse.json(
      { error: { code: "internal", message: "Retry" } },
      { status: 500 },
    );
  }

  // 200 for every DECIDED outcome, including the ones we refuse to act on —
  // retrying those would never succeed.
  return NextResponse.json({ received: true, ...result });
}
