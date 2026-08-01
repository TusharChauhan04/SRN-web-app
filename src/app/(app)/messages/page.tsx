import Link from "next/link";
import { redirect } from "next/navigation";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  formatRelative,
} from "@/components/ui";

export const metadata = { title: "Messages — SRN" };

/**
 * Ported from mobile src/screens/shared/ChatListScreen.tsx.
 *
 * `?to=<userId>` opens (or starts) a thread with someone — that's how the
 * "Message" buttons on profiles, quotes and bookings get here.
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { to } = await searchParams;

  // A thread may not exist yet, in which case the compose screen creates it on
  // first send rather than writing an empty conversation now.
  if (to) {
    const profile = await gateway.profile.public({ userId: to });
    if (profile.conversationId) redirect(`/messages/${profile.conversationId}`);
    redirect(`/messages/new?to=${to}`);
  }

  const page = await gateway.messages.listConversations({ limit: 50 });

  return (
    <>
      <PageHeader
        title="Messages"
        description="Conversations with the people you're working with."
      />

      {page.items.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="Message a provider from their profile, a quote, or a booking."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-[var(--border)]">
            {page.items.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`/messages/${conversation.id}`}
                  className="flex items-center gap-3 p-4 hover:bg-[var(--muted)]"
                >
                  <Avatar
                    name={conversation.counterpart?.name ?? "?"}
                    src={conversation.counterpart?.avatarUrl}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate font-medium">
                        {conversation.counterpart?.name ?? "Unknown"}
                      </p>
                      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                        {formatRelative(conversation.lastMessageAt)}
                      </span>
                    </div>
                    <p className="truncate text-sm text-[var(--muted-foreground)]">
                      {conversation.lastMessageText ?? "No messages yet"}
                    </p>
                  </div>
                  {conversation.unreadCount ? (
                    <Badge tone="info">{conversation.unreadCount}</Badge>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
