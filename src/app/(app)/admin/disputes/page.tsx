import Link from "next/link";
import { gateway } from "@/lib/gateway";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  formatCurrency,
  formatRelative,
  humanize,
  statusTone,
} from "@/components/ui";
import { ResolveDisputeForm } from "./ResolveDisputeForm";

export const metadata = { title: "Disputes — Admin — SRN" };

/** Ported from mobile src/screens/admin/DisputesManagementScreen.tsx. */
export default async function AdminDisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status =
    sp.status === "resolved" || sp.status === "rejected"
      ? sp.status
      : sp.status === "all"
        ? undefined
        : "open";

  const page = await gateway.admin.listDisputes({ status, limit: 50 });

  const tabs = [
    { key: "open", label: "Open" },
    { key: "resolved", label: "Resolved" },
    { key: "rejected", label: "Rejected" },
    { key: "all", label: "All" },
  ];

  return (
    <>
      <PageHeader
        title="Disputes"
        description="Both sides are notified when you close one."
      />

      <nav className="mb-6 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const active =
            (sp.status ?? "open") === tab.key ||
            (tab.key === "open" && !sp.status);
          return (
            <Link
              key={tab.key}
              href={`/admin/disputes?status=${tab.key}`}
              className={`rounded-full px-3 py-1.5 text-sm transition ${
                active
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:bg-[var(--border)]"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {page.items.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description="No disputes match this filter."
        />
      ) : (
        <ul className="space-y-4">
          {page.items.map((dispute) => (
            <li key={dispute.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={dispute.raisedBy?.name ?? "?"}
                      src={dispute.raisedBy?.avatarUrl}
                    />
                    <div className="min-w-0">
                      <p className="font-medium">{dispute.reason}</p>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        Raised by {dispute.raisedBy?.name} ·{" "}
                        {formatRelative(dispute.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {dispute.booking ? (
                      <span className="text-sm font-medium tabular-nums">
                        {formatCurrency(dispute.booking.amount)}
                      </span>
                    ) : null}
                    <Badge tone={statusTone(dispute.status)}>
                      {humanize(dispute.status)}
                    </Badge>
                  </div>
                </div>

                <p className="mt-4 whitespace-pre-wrap rounded-xl bg-[var(--muted)] p-4 text-sm leading-relaxed">
                  {dispute.details}
                </p>

                {dispute.evidenceUrls.length > 0 ? (
                  <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                    {dispute.evidenceUrls.length} evidence file
                    {dispute.evidenceUrls.length === 1 ? "" : "s"} attached
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  <Link
                    href={`/bookings/${dispute.bookingId}`}
                    className="text-[var(--primary)] hover:underline"
                  >
                    View booking
                  </Link>
                  {dispute.booking ? (
                    <>
                      <Link
                        href={`/providers/${dispute.booking.customerId}`}
                        className="text-[var(--primary)] hover:underline"
                      >
                        Customer
                      </Link>
                      <Link
                        href={`/providers/${dispute.booking.providerId}`}
                        className="text-[var(--primary)] hover:underline"
                      >
                        Provider
                      </Link>
                    </>
                  ) : null}
                </div>

                {dispute.status === "open" ||
                dispute.status === "under_review" ? (
                  <div className="mt-4 border-t border-[var(--border)] pt-4">
                    <ResolveDisputeForm disputeId={dispute.id} />
                  </div>
                ) : dispute.resolution ? (
                  <div className="mt-4 border-t border-[var(--border)] pt-4">
                    <p className="text-sm font-medium">Decision</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--muted-foreground)]">
                      {dispute.resolution}
                    </p>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
