import { redirect } from "next/navigation";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import {
  Alert,
  Badge,
  Card,
  PageHeader,
  formatDate,
  humanize,
  statusTone,
} from "@/components/ui";
import { KycSubmitForm } from "./KycSubmitForm";

export const metadata = { title: "Identity verification — SRN" };

/**
 * Identity document submission.
 *
 * No mobile screen ported directly — mobile had a `/verify/submit` endpoint but
 * the queue could only be populated from outside the app. Without this page the
 * admin verification queue built in Phase 5 would only ever show seed data.
 */
export default async function VerificationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const status = await gateway.kyc.status();

  return (
    <>
      <PageHeader
        title="Identity verification"
        description="Verified accounts rank higher in search and win more work."
      />

      {status.isVerified ? (
        <Card className="mb-6 p-6">
          <Badge tone="success">Verified</Badge>
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">
            Your identity has been confirmed. Nothing further is needed.
          </p>
        </Card>
      ) : null}

      {status.latest ? (
        <Card className="mb-6 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {status.latest.docType.toUpperCase()} submitted
              </p>
              <p className="text-sm text-[var(--muted-foreground)]">
                {formatDate(status.latest.createdAt)} ·{" "}
                {status.latest.docUrls.length} file
                {status.latest.docUrls.length === 1 ? "" : "s"}
              </p>
            </div>
            <Badge tone={statusTone(status.latest.status)}>
              {humanize(status.latest.status)}
            </Badge>
          </div>

          {status.latest.status === "rejected" && status.latest.reviewNote ? (
            <div className="mt-4">
              <Alert>
                <strong>Why it was rejected:</strong> {status.latest.reviewNote}
              </Alert>
            </div>
          ) : null}

          {status.latest.status === "pending" ? (
            <p className="mt-4 text-sm text-[var(--muted-foreground)]">
              An administrator is reviewing your documents. You&apos;ll be
              notified when that&apos;s done.
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="mb-6">
        <Alert tone="info">
          Your documents are stored privately and are only ever opened by an
          administrator reviewing this request — every access is logged. They are
          never shown on your public profile.
        </Alert>
      </div>

      {status.canSubmit ? (
        <KycSubmitForm
          isResubmission={status.latest?.status === "rejected"}
        />
      ) : (
        <Card className="p-6">
          <p className="text-sm text-[var(--muted-foreground)]">
            You can submit again once the current review finishes.
          </p>
        </Card>
      )}
    </>
  );
}
