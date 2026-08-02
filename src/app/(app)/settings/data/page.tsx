import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gateway, GatewayError } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { Alert, Card, CardHeader, PageHeader, formatDate } from "@/components/ui";
import { DataRightsPanel } from "./DataRightsPanel";

export const metadata = { title: "Your data — SRN" };

export type DataState = { error?: string; ok?: string };

async function requestDeletion(
  _prev: DataState,
  formData: FormData,
): Promise<DataState> {
  "use server";
  if (String(formData.get("confirm") ?? "") !== "DELETE") {
    return { error: "Type DELETE exactly to confirm." };
  }
  try {
    await gateway.gdpr.requestDeletion({ confirm: "DELETE" });
  } catch (err) {
    if (err instanceof GatewayError) return { error: err.message };
    throw err;
  }
  revalidatePath("/settings/data");
  return { ok: "Deletion scheduled. You can cancel any time before it runs." };
}

async function cancelDeletion(): Promise<void> {
  "use server";
  await gateway.gdpr.cancelDeletion().catch(() => {});
  revalidatePath("/settings/data");
}

/**
 * Data export and account deletion.
 *
 * Ported from the mobile backend's `/gdpr/*` endpoints, which had no mobile
 * screen — the rights existed but nobody could exercise them.
 */
export default async function DataRightsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rights = await gateway.gdpr.rights();

  return (
    <>
      <PageHeader
        title="Your data"
        description="Download everything we hold about you, or close your account."
      />

      {rights.deletionRequestedAt ? (
        <div className="mb-6">
          <Alert tone="warning">
            <strong>Deletion is scheduled.</strong> Requested{" "}
            {formatDate(rights.deletionRequestedAt)}
            {rights.deletionEffectiveAt
              ? `, and becomes permanent on ${formatDate(rights.deletionEffectiveAt)}`
              : ""}
            . You can still cancel below.
          </Alert>
        </div>
      ) : null}

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="What's included in an export"
            description="Your own data only."
          />
          <div className="p-5 text-sm text-[var(--muted-foreground)]">
            <p>
              Your profile, requirements, quotes, bookings, reviews you wrote,
              messages you were part of, disputes, portfolio, uploads,
              subscription, availability and notification settings.
            </p>
            <p className="mt-3">
              {/*
                Said plainly rather than buried: an export is not a licence to
                receive someone else's personal data, so these are deliberately
                excluded or reduced to counts.
              */}
              Deliberately excluded: who reviewed you, who reported you, who
              viewed your profile, and your block list. Those identify other
              people, so they aren&apos;t ours to hand over.
            </p>
            <p className="mt-3">
              You currently have {rights.storedFileCount} stored file
              {rights.storedFileCount === 1 ? "" : "s"}.
            </p>
          </div>
        </Card>

        <DataRightsPanel
          deletionRequested={rights.deletionRequestedAt !== null}
          requestAction={requestDeletion}
          cancelAction={cancelDeletion}
        />
      </div>
    </>
  );
}
