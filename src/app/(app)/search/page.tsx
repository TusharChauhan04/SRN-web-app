import Link from "next/link";
import { redirect } from "next/navigation";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  formatCurrency,
} from "@/components/ui";

export const metadata = { title: "Find providers — SRN" };

/**
 * Ported from mobile src/screens/shared/SearchScreen.tsx.
 *
 * Filters live in the URL rather than component state so a search is
 * shareable and survives a reload — a web affordance mobile didn't have.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    skills?: string;
    role?: string;
    location?: string;
    maxRate?: string;
    minRating?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const sp = await searchParams;

  const skills = sp.skills
    ? sp.skills.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const page = await gateway.search.providers({
    query: sp.q || undefined,
    skills,
    location: sp.location || undefined,
    role: sp.role === "digital" || sp.role === "local" ? sp.role : undefined,
    maxHourlyRate: sp.maxRate ? Number(sp.maxRate) : undefined,
    minRating: sp.minRating ? Number(sp.minRating) : undefined,
    limit: 50,
  });

  const total = page.total ?? page.items.length;

  return (
    <>
      <PageHeader
        title="Find providers"
        description="Search by skill, location, rate or rating."
      />

      {/* GET form: the browser puts the filters in the URL for us. */}
      <Card className="mb-6 p-5">
        <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Search" htmlFor="q">
            <Input
              id="q"
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Name, title or bio"
            />
          </Field>

          <Field label="Skills" htmlFor="skills" hint="Comma separated">
            <Input
              id="skills"
              name="skills"
              defaultValue={sp.skills ?? ""}
              placeholder="react, figma"
            />
          </Field>

          <Field label="Provider type" htmlFor="role">
            <Select id="role" name="role" defaultValue={sp.role ?? ""}>
              <option value="">Any</option>
              <option value="digital">Digital / remote</option>
              <option value="local">Local / on-site</option>
            </Select>
          </Field>

          <Field label="Location" htmlFor="location">
            <Input
              id="location"
              name="location"
              defaultValue={sp.location ?? ""}
              placeholder="Bengaluru"
            />
          </Field>

          <Field label="Max hourly rate (₹)" htmlFor="maxRate">
            <Input
              id="maxRate"
              name="maxRate"
              type="number"
              min={0}
              defaultValue={sp.maxRate ?? ""}
            />
          </Field>

          <Field label="Minimum rating" htmlFor="minRating">
            <Select
              id="minRating"
              name="minRating"
              defaultValue={sp.minRating ?? ""}
            >
              <option value="">Any</option>
              <option value="4">4★ and up</option>
              <option value="4.5">4.5★ and up</option>
            </Select>
          </Field>

          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <Button type="submit">Search</Button>
            <Link
              href="/search"
              className="text-sm text-[var(--muted-foreground)] hover:underline"
            >
              Clear filters
            </Link>
          </div>
        </form>
      </Card>

      <p className="mb-4 text-sm text-[var(--muted-foreground)]">
        {total} provider{total === 1 ? "" : "s"}
      </p>

      {page.items.length === 0 ? (
        <EmptyState
          title="No providers match those filters"
          description="Try removing a filter or widening the rate range."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {page.items.map((provider) => (
            <li key={provider.id}>
              <Card className="h-full transition hover:ring-2 hover:ring-[var(--primary)]">
                <Link
                  href={`/providers/${provider.id}`}
                  className="flex h-full flex-col p-5"
                >
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={provider.name}
                      src={provider.avatarUrl}
                      size={48}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-medium">{provider.name}</p>
                        {provider.isVerified ? (
                          <span
                            title="Verified"
                            aria-label="Verified"
                            className="text-[var(--accent)]"
                          >
                            ✓
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-sm text-[var(--muted-foreground)]">
                        {provider.title ?? "Provider"}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                        {provider.rating > 0
                          ? `${provider.rating.toFixed(1)}★ (${provider.reviewsCount})`
                          : "No reviews yet"}
                        {provider.location ? ` · ${provider.location}` : ""}
                      </p>
                    </div>
                  </div>

                  {provider.bio ? (
                    <p className="mt-3 line-clamp-2 text-sm text-[var(--muted-foreground)]">
                      {provider.bio}
                    </p>
                  ) : null}

                  {provider.skills.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {provider.skills.slice(0, 5).map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-auto flex items-center justify-between pt-4 text-sm">
                    <span className="text-[var(--muted-foreground)]">
                      {provider.completedGigs} completed
                    </span>
                    {provider.hourlyRate ? (
                      <span className="font-medium tabular-nums">
                        {formatCurrency(provider.hourlyRate)}/hr
                      </span>
                    ) : null}
                  </div>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
