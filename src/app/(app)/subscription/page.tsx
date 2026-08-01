import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { PageHeader, formatDate } from "@/components/ui";
import { PlanPicker } from "./PlanPicker";

export const metadata = { title: "Subscription — SRN" };

async function cancelSubscription(): Promise<void> {
  "use server";
  await gateway.subscriptions.cancel().catch(() => {});
  revalidatePath("/subscription");
}

/** Ported from mobile src/screens/shared/SubscriptionScreen.tsx. */
export default async function SubscriptionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const view = await gateway.subscriptions.view();

  const renewalNote = view.current?.currentPeriodEnd
    ? view.current.cancelAtPeriodEnd
      ? `Your plan ends on ${formatDate(view.current.currentPeriodEnd)}.`
      : `Renews on ${formatDate(view.current.currentPeriodEnd)}.`
    : undefined;

  return (
    <>
      <PageHeader
        title="Subscription"
        description={
          renewalNote ?? "Upgrade for better placement and more portfolio space."
        }
      />
      <PlanPicker
        plans={view.plans}
        publicKey={view.publicKey}
        providerName={view.providerName}
        canCancel={
          view.current !== null &&
          view.current.tier !== "free" &&
          !view.current.cancelAtPeriodEnd
        }
        cancelAction={cancelSubscription}
      />
    </>
  );
}
