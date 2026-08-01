import Link from "next/link";
import { gateway } from "@/lib/gateway";
import {
  ROLE_LABELS,
  USER_ROLES,
  type UserRole,
} from "@/lib/repositories/types";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  RoleBadge,
  Select,
  formatDate,
} from "@/components/ui";
import { setRole, setSuspended } from "../actions";
import { EraseUserDialog } from "./EraseUserDialog";

export const metadata = { title: "Users — Admin — SRN" };

/** Ported from mobile src/screens/admin/UsersScreen.tsx. */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; suspended?: string }>;
}) {
  const sp = await searchParams;

  const page = await gateway.admin.listUsers({
    query: sp.q || undefined,
    role: USER_ROLES.includes(sp.role as UserRole)
      ? (sp.role as UserRole)
      : undefined,
    isSuspended: sp.suspended === "true" ? true : undefined,
    limit: 50,
  });

  const total = page.total ?? page.items.length;

  return (
    <>
      <PageHeader
        title="Users"
        description={`${total} account${total === 1 ? "" : "s"}. Searching by name or email is recorded in the audit log.`}
      />

      <Card className="mb-6 p-5">
        <form className="grid gap-4 sm:grid-cols-3">
          <Field label="Search" htmlFor="q" hint="Name, email, title or bio">
            <Input id="q" name="q" defaultValue={sp.q ?? ""} />
          </Field>
          <Field label="Role" htmlFor="role">
            <Select id="role" name="role" defaultValue={sp.role ?? ""}>
              <option value="">Any</option>
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="suspended">
            <Select
              id="suspended"
              name="suspended"
              defaultValue={sp.suspended ?? ""}
            >
              <option value="">All</option>
              <option value="true">Suspended only</option>
            </Select>
          </Field>
          <div className="flex items-end gap-2 sm:col-span-3">
            <Button type="submit">Search</Button>
            <Link
              href="/admin/users"
              className="text-sm text-[var(--muted-foreground)] hover:underline"
            >
              Clear
            </Link>
          </div>
        </form>
      </Card>

      {page.items.length === 0 ? (
        <EmptyState title="No users match those filters" />
      ) : (
        <ul className="space-y-3">
          {page.items.map((user) => (
            <li key={user.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start gap-4">
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
                      {user.isSuspended ? (
                        <Badge tone="danger">Suspended</Badge>
                      ) : null}
                      {user.isVerified ? (
                        <Badge tone="success">Verified</Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">
                      {user.email}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      Joined {formatDate(user.createdAt)} · {user.completedGigs}{" "}
                      completed
                      {user.rating > 0 ? ` · ${user.rating.toFixed(1)}★` : ""}
                    </p>
                  </div>
                </div>

                {/* Admins are deliberately not actionable from this screen. */}
                {user.role === "admin" ? (
                  <p className="mt-4 text-sm text-[var(--muted-foreground)]">
                    Administrator accounts can&apos;t be modified here.
                  </p>
                ) : (
                  <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-[var(--border)] pt-4">
                    <form action={setSuspended}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input
                        type="hidden"
                        name="suspended"
                        value={String(!user.isSuspended)}
                      />
                      <Button size="sm" variant="outline" type="submit">
                        {user.isSuspended ? "Unsuspend" : "Suspend"}
                      </Button>
                    </form>

                    <form action={setRole} className="flex items-end gap-2">
                      <input type="hidden" name="userId" value={user.id} />
                      <label
                        htmlFor={`role-${user.id}`}
                        className="sr-only"
                      >{`Role for ${user.name}`}</label>
                      <Select
                        id={`role-${user.id}`}
                        name="role"
                        defaultValue={user.role}
                        className="h-8 w-44 text-sm"
                      >
                        {USER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="outline" type="submit">
                        Change role
                      </Button>
                    </form>

                    <EraseUserDialog userId={user.id} userName={user.name} />
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
