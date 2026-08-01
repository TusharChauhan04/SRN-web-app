import Link from "next/link";
import { gateway } from "@/lib/gateway";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  formatRelative,
} from "@/components/ui";

export const metadata = { title: "Audit log — Admin — SRN" };

/** Actions that change privilege or destroy data get visual weight. */
const HIGH_RISK = new Set([
  "admin.user.role_changed",
  "admin.user.erased",
  "admin.user.suspended",
  "admin.flag.changed",
  "identity.deleted",
]);

/** No mobile equivalent — /admin/audit-logs existed with no screen. */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actorId?: string }>;
}) {
  const sp = await searchParams;

  const page = await gateway.admin.listAudit({
    action: sp.action || undefined,
    actorId: sp.actorId || undefined,
    limit: 100,
  });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who did what. Privileged reads are recorded here too, not just writes."
      />

      <Card className="mb-6 p-5">
        <form className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Action"
            htmlFor="action"
            hint="e.g. admin.user.role_changed"
          >
            <Input id="action" name="action" defaultValue={sp.action ?? ""} />
          </Field>
          <Field label="Actor id" htmlFor="actorId">
            <Input id="actorId" name="actorId" defaultValue={sp.actorId ?? ""} />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit">Filter</Button>
            <Link
              href="/admin/audit"
              className="text-sm text-[var(--muted-foreground)] hover:underline"
            >
              Clear
            </Link>
          </div>
        </form>
      </Card>

      {page.items.length === 0 ? (
        <EmptyState
          title="No matching events"
          description="Try clearing the filters."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--border)]">
            {page.items.map((event) => (
              <li key={event.id} className="px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="font-mono text-sm">{event.action}</code>
                      {HIGH_RISK.has(event.action) ? (
                        <Badge tone="danger">High risk</Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                      {event.actor
                        ? `${event.actor.name} (${event.actor.email})`
                        : "System"}
                      {event.target ? ` → ${event.target}` : ""}
                    </p>
                    {event.metadata ? (
                      <p className="mt-1 font-mono text-xs text-[var(--muted-foreground)]">
                        {JSON.stringify(event.metadata)}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {formatRelative(event.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
