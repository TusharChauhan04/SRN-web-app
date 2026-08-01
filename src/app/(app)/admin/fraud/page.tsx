import Link from "next/link";
import { gateway } from "@/lib/gateway";
import {
  Alert,
  Avatar,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  RoleBadge,
  formatDate,
} from "@/components/ui";

export const metadata = { title: "Fraud signals — Admin — SRN" };

/** No mobile equivalent — /admin/fraud/* existed with no screen. */
export default async function AdminFraudPage() {
  const data = await gateway.admin.fraud();

  return (
    <>
      <PageHeader
        title="Fraud signals"
        description="Heuristics worth a human look. None of this is proof."
      />

      <div className="mb-6">
        {/*
          Honest about what this is. The schema carries no device or IP
          fingerprint, so these are weak signals, not detections — saying so
          prevents someone treating a list position as evidence.
        */}
        <Alert tone="info">
          These are cheap heuristics — new accounts with improbable review
          counts, and five-star reviews with no written comment. There is no
          device or IP fingerprinting behind them, so treat a listing here as a
          prompt to look, not a finding.
        </Alert>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader
            title={`Accounts worth checking (${data.suspiciousAccounts.length})`}
            description="Recently created, already heavily reviewed."
          />
          {data.suspiciousAccounts.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Nothing flagged" />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.suspiciousAccounts.map((user) => (
                <li
                  key={user.id}
                  className="flex items-center gap-3 px-5 py-4"
                >
                  <Avatar name={user.name} src={user.avatarUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/providers/${user.id}`}
                        className="font-medium hover:underline"
                      >
                        {user.name}
                      </Link>
                      <RoleBadge role={user.role} />
                    </div>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      Joined {formatDate(user.createdAt)} · {user.reviewsCount}{" "}
                      reviews · {user.rating.toFixed(1)}★
                    </p>
                  </div>
                  <Link
                    href={`/admin/users?q=${encodeURIComponent(user.email)}`}
                    className="shrink-0 text-sm text-[var(--primary)] hover:underline"
                  >
                    Manage
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title={`Reviews worth checking (${data.suspiciousReviews.length})`}
            description="Already flagged, or five stars with nothing written."
          />
          {data.suspiciousReviews.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Nothing flagged" />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.suspiciousReviews.map((review) => (
                <li key={review.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar
                        name={review.author?.name ?? "?"}
                        src={review.author?.avatarUrl}
                        size={32}
                      />
                      <div>
                        <p className="text-sm font-medium">
                          {review.author?.name ?? "Unknown"}
                        </p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {formatDate(review.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {review.isFlagged ? (
                        <Badge tone="danger">Flagged</Badge>
                      ) : null}
                      <span className="text-amber-400">
                        {"★".repeat(review.rating)}
                      </span>
                    </div>
                  </div>
                  {review.comment ? (
                    <p className="mt-2 text-sm">{review.comment}</p>
                  ) : (
                    <p className="mt-2 text-sm italic text-[var(--muted-foreground)]">
                      No comment written
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
