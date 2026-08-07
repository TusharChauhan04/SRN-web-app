import Link from "next/link";
import { gateway } from "@/lib/gateway";
import {
  Alert,
  Avatar,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  RoleBadge,
  formatRelative,
  humanize,
  statusTone,
} from "@/components/ui";
import { VerificationReview } from "./VerificationReview";

export const metadata = { title: "Verification — Admin — SRN" };

/** Ported from mobile src/screens/admin/VerificationQueueScreen.tsx. */
export default async function AdminVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status =
    sp.status === "approved" || sp.status === "rejected"
      ? sp.status
      : "pending";

  const page = await gateway.admin.listVerifications({ status, limit: 50 });

  const tabs = [
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <>
      <PageHeader
        title="Verification queue"
        description="Identity documents awaiting review, oldest first."
      />

      <div className="mb-6">
        <Alert tone="warning">
          These are identity documents. Opening one is recorded in the audit log
          against your account, and the links expire shortly after issue.
        </Alert>
      </div>

      <nav className="mb-6 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/verification?status=${tab.key}`}
            className={`rounded-full px-3 py-1.5 text-sm transition ${
              status === tab.key
                ? "nm-raised-sm bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "text-[var(--muted-foreground)] hover:nm-raised-sm"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {page.items.length === 0 ? (
        <EmptyState
          title={status === "pending" ? "Queue is clear" : "Nothing here"}
          description={
            status === "pending"
              ? "No identity documents are waiting for review."
              : undefined
          }
        />
      ) : (
        <ul className="space-y-4">
          {page.items.map((request) => (
            <li key={request.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={request.user?.name ?? "?"}
                      src={request.user?.avatarUrl}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/providers/${request.userId}`}
                          className="font-medium hover:underline"
                        >
                          {request.user?.name}
                        </Link>
                        {request.user ? (
                          <RoleBadge role={request.user.role} />
                        ) : null}
                      </div>
                      <p className="truncate text-sm text-[var(--muted-foreground)]">
                        {request.user?.email}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        {request.docType.toUpperCase()} ·{" "}
                        {request.docUrls.length} file
                        {request.docUrls.length === 1 ? "" : "s"} · submitted{" "}
                        {formatRelative(request.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Badge tone={statusTone(request.status)}>
                    {humanize(request.status)}
                  </Badge>
                </div>

                {request.status === "pending" ? (
                  <div className="mt-4 border-t border-[var(--border)] pt-4">
                    <VerificationReview requestId={request.id} />
                  </div>
                ) : request.reviewNote ? (
                  <p className="mt-4 border-t border-[var(--border)] pt-4 text-sm text-[var(--muted-foreground)]">
                    <span className="font-medium text-[var(--foreground)]">
                      Note:
                    </span>{" "}
                    {request.reviewNote}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
