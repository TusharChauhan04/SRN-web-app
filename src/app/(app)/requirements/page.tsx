import Link from "next/link";
import { redirect } from "next/navigation";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { isProviderRole } from "@/lib/repositories/types";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  formatCurrency,
  formatRelative,
  humanize,
  statusTone,
} from "@/components/ui";

export const metadata = { title: "Requirements — SRN" };

/**
 * One route, two meanings — matching the mobile navigators, where "My
 * requirements" (business/customer) and "Find work" (digital/local) are
 * different tabs pointing at the same underlying data.
 */
export default async function RequirementsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const isProvider = isProviderRole(user.role);
  const page = isProvider
    ? await gateway.requirements.feed({ limit: 50 })
    : await gateway.requirements.listMine({ limit: 50 });

  return (
    <>
      <PageHeader
        title={isProvider ? "Find work" : "My requirements"}
        description={
          isProvider
            ? "Open requirements matched to the skills on your profile."
            : "Everything you've posted, and how many quotes each has attracted."
        }
        action={
          isProvider ? null : (
            <ButtonLink href="/requirements/new">Post a requirement</ButtonLink>
          )
        }
      />

      {page.items.length === 0 ? (
        <EmptyState
          title={isProvider ? "No matching work right now" : "Nothing posted yet"}
          description={
            isProvider
              ? user.skills.length === 0
                ? "Add skills to your profile so we can match you to requirements."
                : "New requirements are posted daily — check back shortly."
              : "Describe what you need and providers will come to you."
          }
          action={
            isProvider ? (
              user.skills.length === 0 ? (
                <ButtonLink href="/profile" size="sm">
                  Add skills
                </ButtonLink>
              ) : null
            ) : (
              <ButtonLink href="/requirements/new" size="sm">
                Post a requirement
              </ButtonLink>
            )
          }
        />
      ) : (
        <ul className="space-y-3">
          {page.items.map((req) => (
            <li key={req.id}>
              <Card className="transition outline-0 outline-[var(--primary)] hover:outline-2">
                <Link href={`/requirements/${req.id}`} className="block p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="min-w-0 flex-1 font-medium">{req.title}</h2>
                    <Badge tone={statusTone(req.status)}>
                      {humanize(req.status)}
                    </Badge>
                  </div>

                  <p className="mt-2 line-clamp-2 text-sm text-[var(--muted-foreground)]">
                    {req.description}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--muted-foreground)]">
                    <span className="font-medium text-[var(--foreground)]">
                      {formatCurrency(req.minBudget)}–{formatCurrency(req.maxBudget)}
                    </span>
                    <span>{req.category}</span>
                    {req.location ? <span>{req.location}</span> : null}
                    <span>Posted {formatRelative(req.createdAt)}</span>
                    {req.quoteCount !== undefined ? (
                      <span>
                        {req.quoteCount} quote{req.quoteCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>

                  {req.skillsNeeded.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {req.skillsNeeded.slice(0, 6).map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </div>
                  ) : null}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
