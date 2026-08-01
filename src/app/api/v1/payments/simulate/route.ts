/**
 * Development-only payment simulation.
 *
 * The mock provider signs webhooks with a server-held secret, so a browser
 * cannot forge one — which is correct, and also means the local checkout flow
 * needs a server-side way to fire the webhook it would otherwise receive from
 * Razorpay.
 *
 * This posts a properly signed payload through the REAL webhook route, so the
 * signature verification, replay guard and grant logic all execute exactly as
 * they will in production. It refuses to exist outside development.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  configuredPaymentProviderName,
  signMockWebhook,
} from "@/lib/providers/payments/index.server";
import { applyVerifiedPayment } from "@/lib/services/subscriptions.service";
import { paymentProvider } from "@/lib/providers/payments/index.server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  orderId: z.string().min(1),
  amountMinor: z.number().int().min(0),
  /** Optional, so a genuine provider retry can be reproduced locally. */
  paymentId: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  if (
    process.env.NODE_ENV === "production" ||
    configuredPaymentProviderName() !== "mock"
  ) {
    // Look like it doesn't exist rather than admitting it's disabled.
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found" } },
      { status: 404 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_failed", message: "Bad request" } },
      { status: 422 },
    );
  }

  const payload = JSON.stringify({
    event: "payment.captured",
    orderId: parsed.data.orderId,
    paymentId: parsed.data.paymentId ?? `mock_pay_${Date.now()}`,
    amountMinor: parsed.data.amountMinor,
  });

  // Sign and verify through the provider, so this exercises the same path a
  // real webhook takes rather than shortcutting to the grant.
  const event = paymentProvider().verifyWebhook(
    payload,
    signMockWebhook(payload),
  );

  if (event.kind !== "payment.captured" || !event.orderId || !event.paymentId) {
    return NextResponse.json({ applied: false, reason: "not_captured" });
  }

  const result = await applyVerifiedPayment({
    orderId: event.orderId,
    paymentId: event.paymentId,
    amountMinor: event.amountMinor,
  });

  return NextResponse.json(result);
}
