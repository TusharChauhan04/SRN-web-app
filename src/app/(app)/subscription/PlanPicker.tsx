"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callGateway } from "@/lib/gateway/client";
import type { PlanView } from "@/lib/services/subscriptions.service";
import {
  Alert,
  Badge,
  Button,
  Card,
  Spinner,
  formatCurrency,
} from "@/components/ui";

interface CheckoutOrder {
  orderId: string;
  amountMinor: number;
  currency: string;
  publicKey: string;
  tier: string;
  customerName: string;
  customerEmail: string;
}

/** Razorpay's Checkout.js global, once the script has loaded. */
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: unknown) => void) => void;
    };
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CHECKOUT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Checkout failed to load")),
      );
      return;
    }

    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Checkout failed to load"));
    document.body.appendChild(script);
  });
}

export function PlanPicker({
  plans,
  publicKey,
  providerName,
  canCancel,
  cancelAction,
}: {
  plans: PlanView[];
  publicKey: string | null;
  providerName: string;
  canCancel: boolean;
  cancelAction: () => Promise<void>;
}) {
  const router = useRouter();
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isMock = providerName === "mock";

  const upgrade = async (tier: string) => {
    setBusyTier(tier);
    setError(null);
    setNotice(null);

    try {
      // The server creates the order and decides the amount. Nothing about
      // price is sent from here.
      const order = await callGateway<CheckoutOrder>(
        "subscriptions.checkout",
        { tier },
      );

      if (isMock) {
        // Development: fire the signed webhook server-side. The grant still
        // happens only in the webhook path, exactly as in production.
        const res = await fetch("/api/v1/payments/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: order.orderId,
            amountMinor: order.amountMinor,
          }),
        });
        if (!res.ok) throw new Error("Simulated payment failed.");

        setNotice(`Simulated payment complete — you're on the ${tier} plan.`);
        router.refresh();
        return;
      }

      await loadCheckoutScript();
      if (!window.Razorpay) throw new Error("Checkout is unavailable.");

      const checkout = new window.Razorpay({
        key: order.publicKey,
        order_id: order.orderId,
        amount: order.amountMinor,
        currency: order.currency,
        name: "SRN — Skill Requirement Network",
        description: `SRN ${tier} plan`,
        prefill: { name: order.customerName, email: order.customerEmail },
        theme: { color: "#7c3aed" },
        handler: () => {
          // Success here means the BROWSER thinks it worked. The tier is
          // granted by the verified webhook, which may land a moment later —
          // so refresh and say so rather than claiming it's done.
          setNotice(
            "Payment received. Your plan will update within a few moments.",
          );
          router.refresh();
        },
        modal: {
          ondismiss: () => setBusyTier(null),
        },
      });

      checkout.on("payment.failed", () => {
        setError("That payment didn't go through. No charge was made.");
        setBusyTier(null);
      });

      checkout.open();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't start checkout.",
      );
    } finally {
      if (isMock) setBusyTier(null);
    }
  };

  return (
    <div className="space-y-6">
      {isMock ? (
        <Alert tone="warning">
          Development payments — no money moves. Upgrading fires a signed
          webhook locally so the real grant path is exercised. Set{" "}
          <code className="font-mono">PAYMENT_PROVIDER=razorpay</code> with keys
          for live checkout.
        </Alert>
      ) : null}

      {!publicKey && !isMock ? (
        <Alert>
          Payments aren&apos;t configured, so upgrading is unavailable. Add the
          Razorpay keys to enable it.
        </Alert>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      <ul className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <li key={plan.tier}>
            <Card
              className={`flex h-full flex-col p-6 ${
                plan.isCurrent ? "outline-2 outline-[var(--primary)]" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{plan.name}</h2>
                {plan.isCurrent ? <Badge tone="success">Current</Badge> : null}
              </div>

              <p className="mt-3">
                <span className="text-3xl font-semibold tabular-nums">
                  {plan.price === 0 ? "Free" : formatCurrency(plan.price)}
                </span>
                {plan.price > 0 ? (
                  <span className="text-sm text-[var(--muted-foreground)]">
                    {" "}
                    / month
                  </span>
                ) : null}
              </p>

              <ul className="mt-5 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden className="text-[var(--accent-text)]">
                      ✓
                    </span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto pt-6">
                {plan.isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    Your plan
                  </Button>
                ) : plan.tier === "free" ? (
                  <Button variant="ghost" className="w-full" disabled>
                    Downgrade at period end
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    disabled={busyTier !== null || (!publicKey && !isMock)}
                    onClick={() => void upgrade(plan.tier)}
                  >
                    {busyTier === plan.tier ? (
                      <Spinner className="h-4 w-4" />
                    ) : null}
                    Upgrade to {plan.name}
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {canCancel ? (
        <form action={cancelAction}>
          <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <h2 className="font-medium">Cancel subscription</h2>
              <p className="text-sm text-[var(--muted-foreground)]">
                You keep your plan until the end of the current billing period.
              </p>
            </div>
            <Button variant="outline" type="submit">
              Cancel at period end
            </Button>
          </Card>
        </form>
      ) : null}
    </div>
  );
}
