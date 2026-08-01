import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  formatRelative,
} from "@/components/ui";

export const metadata = { title: "Notifications — SRN" };

async function markAllRead() {
  "use server";
  await gateway.notifications.markAllRead();
  revalidatePath("/notifications");
}

/** Ported from mobile src/screens/shared/NotificationsScreen.tsx. */
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const page = await gateway.notifications.list({ limit: 50 });
  const unread = page.items.filter((n) => !n.read).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          unread > 0 ? `${unread} unread` : "You're all caught up."
        }
        action={
          unread > 0 ? (
            <form action={markAllRead}>
              <Button variant="outline" type="submit">
                Mark all read
              </Button>
            </form>
          ) : null
        }
      />

      {page.items.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="Quotes, bookings and messages will show up here."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--border)]">
            {page.items.map((notification) => (
              <li
                key={notification.id}
                className={
                  notification.read ? "p-5" : "border-l-2 border-l-[var(--primary)] p-5"
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{notification.title}</p>
                    <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                      {notification.body}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {formatRelative(notification.createdAt)}
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
