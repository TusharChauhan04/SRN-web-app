import { gateway } from "@/lib/gateway";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  formatRelative,
} from "@/components/ui";
import { setFlag } from "../actions";

export const metadata = { title: "Feature flags — Admin — SRN" };

/** No mobile equivalent — /admin/flags existed with no screen. */
export default async function AdminFlagsPage() {
  const flags = await gateway.admin.listFlags();

  return (
    <>
      <PageHeader
        title="Feature flags"
        description="Changes take effect immediately, for everyone."
      />

      <div className="mb-6">
        <Alert tone="warning">
          These switch behaviour for every user at once. Every change is
          recorded in the audit log against your account.
        </Alert>
      </div>

      {flags.length === 0 ? (
        <EmptyState
          title="No flags defined"
          description="Flags are seeded by the application, not created here."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--border)]">
            {flags.map((flag) => (
              <li
                key={flag.key}
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-sm font-medium">
                      {flag.key}
                    </code>
                    <Badge tone={flag.enabled ? "success" : "neutral"}>
                      {flag.enabled ? "On" : "Off"}
                    </Badge>
                  </div>
                  {flag.description ? (
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {flag.description}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    Changed {formatRelative(flag.updatedAt)}
                  </p>
                </div>

                <form action={setFlag}>
                  <input type="hidden" name="key" value={flag.key} />
                  <input
                    type="hidden"
                    name="enabled"
                    value={String(!flag.enabled)}
                  />
                  <Button
                    size="sm"
                    variant={flag.enabled ? "outline" : "primary"}
                    type="submit"
                  >
                    Turn {flag.enabled ? "off" : "on"}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
