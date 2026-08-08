import { notFound, redirect } from "next/navigation";
import { gateway, GatewayError } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import {
  Avatar,
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  RoleBadge,
  Stat,
  formatCurrency,
  formatDate,
  safeHref,
} from "@/components/ui";

export const metadata = { title: "Provider — SRN" };

/**
 * Ported from mobile src/screens/shared/ProviderProfileScreen.tsx.
 *
 * The service returns a PII-free projection — no email, phone or FCM token
 * reaches this page even though the row behind it has them.
 */
export default async function ProviderProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await getCurrentUser();
  if (!viewer) redirect("/login");

  const { id } = await params;

  let profile;
  try {
    profile = await gateway.profile.public({ userId: id });
  } catch (err) {
    if (err instanceof GatewayError && err.code === "not_found") notFound();
    throw err;
  }

  const { user, reviews, reviewCount, portfolio, isOnline } = profile;
  const isSelf = user.id === viewer.id;

  return (
    <>
      <PageHeader
        title={user.name}
        description={user.title ?? undefined}
        action={
          isSelf ? (
            <ButtonLink variant="outline" href="/profile">
              Edit your profile
            </ButtonLink>
          ) : (
            <ButtonLink href={`/messages?to=${user.id}`}>Message</ButtonLink>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <div className="flex flex-wrap items-start gap-4">
              <Avatar name={user.name} src={user.avatarUrl} size={72} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <RoleBadge role={user.role} />
                  {user.isVerified ? <Badge tone="success">Verified</Badge> : null}
                  {user.isPremium ? <Badge tone="info">Premium</Badge> : null}
                  {isOnline ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Online
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                  {user.location ? `${user.location} · ` : ""}
                  Member since {formatDate(user.createdAt)}
                </p>
                {user.hourlyRate ? (
                  <p className="mt-1 font-medium tabular-nums">
                    {formatCurrency(user.hourlyRate)}/hr
                  </p>
                ) : null}
              </div>
            </div>

            {user.bio ? (
              <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed">
                {user.bio}
              </p>
            ) : null}

            {user.skills.length > 0 ? (
              <div className="mt-5">
                <h2 className="mb-2 text-sm font-medium">Skills</h2>
                <div className="flex flex-wrap gap-1.5">
                  {user.skills.map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          {portfolio.length > 0 ? (
            <Card>
              <CardHeader title="Portfolio" />
              <ul className="grid gap-4 p-5 sm:grid-cols-2">
                {portfolio.map((item) => (
                  <li key={item.id} className="rounded-xl border border-[var(--border)] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium">{item.title}</h3>
                      {item.isFeatured ? <Badge tone="info">Featured</Badge> : null}
                    </div>
                    {item.description ? (
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                        {item.description}
                      </p>
                    ) : null}
                    {safeHref(item.projectUrl) ? (
                      <a
                        href={safeHref(item.projectUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-sm text-[var(--primary)] hover:underline"
                      >
                        View project
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={`Reviews (${reviewCount})`} />
            {reviews.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No reviews yet"
                  description="Reviews appear once a booking with this provider is completed."
                />
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {reviews.map((review) => (
                  <li key={review.id} className="p-5">
                    <div className="flex items-center gap-3">
                      <Avatar
                        name={review.author?.name ?? "?"}
                        src={review.author?.avatarUrl}
                        size={32}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {review.author?.name ?? "Customer"}
                        </p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {formatDate(review.createdAt)}
                        </p>
                      </div>
                      <span className="text-amber-800" aria-label={`${review.rating} stars`}>
                        {"★".repeat(review.rating)}
                        <span className="text-[var(--border)]">
                          {"★".repeat(5 - review.rating)}
                        </span>
                      </span>
                    </div>
                    {review.comment ? (
                      <p className="mt-2 text-sm leading-relaxed">
                        {review.comment}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Stat
            label="Rating"
            value={user.rating > 0 ? `${user.rating.toFixed(1)}★` : "—"}
            hint={`${user.reviewsCount} review${user.reviewsCount === 1 ? "" : "s"}`}
          />
          <Stat label="Completed jobs" value={user.completedGigs} />
          {user.onTimeRate !== null && user.onTimeRate !== undefined ? (
            <Stat
              label="On time"
              value={`${Math.round(user.onTimeRate * 100)}%`}
            />
          ) : null}
          {user.serviceRadiusKm ? (
            <Stat label="Service radius" value={`${user.serviceRadiusKm} km`} />
          ) : null}
        </div>
      </div>
    </>
  );
}
