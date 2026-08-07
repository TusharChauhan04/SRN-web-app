import { gateway } from "@/lib/gateway";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  formatRelative,
  humanize,
  statusTone,
} from "@/components/ui";
import { clearMessageFlag, resolveReport } from "../actions";

export const metadata = { title: "Moderation — Admin — SRN" };

/**
 * No mobile equivalent — the backend had /admin/flagged-messages and
 * /report endpoints with no screen behind them. This is where that capability
 * becomes usable, which is the point of building the admin panel on web.
 */
export default async function AdminModerationPage() {
  const [flagged, reports] = await Promise.all([
    gateway.admin.flaggedMessages({ limit: 50 }),
    gateway.admin.listReports({ status: "open", limit: 50 }),
  ]);

  return (
    <>
      <PageHeader
        title="Moderation"
        description="Flagged messages and open user reports."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader
            title={`Open reports (${reports.total ?? reports.items.length})`}
            description="Filed by users about other users."
          />
          {reports.items.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No open reports" />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {reports.items.map((report) => (
                <li key={report.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{report.reason}</p>
                      <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                        {humanize(report.targetType)} · reported{" "}
                        {formatRelative(report.createdAt)}
                      </p>
                    </div>
                    <Badge tone={statusTone(report.status)}>
                      {humanize(report.status)}
                    </Badge>
                  </div>

                  {report.details ? (
                    <p className="mt-3 whitespace-pre-wrap rounded-xl nm-inset p-3 text-sm">
                      {report.details}
                    </p>
                  ) : null}

                  <form action={resolveReport} className="mt-3">
                    <input type="hidden" name="reportId" value={report.id} />
                    <Button size="sm" variant="outline" type="submit">
                      Mark resolved
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title={`Flagged messages (${flagged.total ?? flagged.items.length})`}
            description="Messages caught by moderation or reported by a recipient."
          />
          {flagged.items.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No flagged messages" />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {flagged.items.map((message) => (
                <li key={message.id} className="p-5">
                  <p className="whitespace-pre-wrap rounded-xl nm-inset p-3 text-sm">
                    {message.text}
                  </p>
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                    Sent {formatRelative(message.createdAt)}
                    {message.isDeleted ? " · deleted by sender" : ""}
                  </p>
                  <form action={clearMessageFlag} className="mt-3">
                    <input type="hidden" name="messageId" value={message.id} />
                    <Button size="sm" variant="outline" type="submit">
                      Clear flag
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
