import { notFound, redirect } from "next/navigation";
import { gateway, GatewayError } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { Card, PageHeader, formatCurrency } from "@/components/ui";
import { BidForm } from "./BidForm";

export const metadata = { title: "Submit a quote — SRN" };

/** Ported from mobile src/screens/shared/BidSubmitScreen.tsx. */
export default async function BidPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;

  let data;
  try {
    data = await gateway.requirements.detail({ id });
  } catch (err) {
    if (err instanceof GatewayError && err.code === "not_found") notFound();
    throw err;
  }

  // The gateway would reject the submission anyway; this avoids showing a form
  // that cannot succeed.
  if (!data.canBid) redirect(`/requirements/${id}`);

  const { requirement } = data;

  return (
    <>
      <PageHeader
        title="Submit a quote"
        description={requirement.title}
      />

      <Card className="mb-6 p-5">
        <p className="text-sm text-[var(--muted-foreground)]">
          Client&apos;s budget
        </p>
        <p className="mt-1 text-lg font-semibold tabular-nums">
          {formatCurrency(requirement.minBudget)} –{" "}
          {formatCurrency(requirement.maxBudget)}
        </p>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
          {requirement.description}
        </p>
      </Card>

      <BidForm
        requirementId={id}
        minBudget={requirement.minBudget}
        maxBudget={requirement.maxBudget}
      />
    </>
  );
}
