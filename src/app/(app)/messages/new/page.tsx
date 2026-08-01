import { redirect } from "next/navigation";
import { gateway } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { Avatar, Card, PageHeader } from "@/components/ui";
import { ComposeFirstMessage } from "./ComposeFirstMessage";

export const metadata = { title: "New message — SRN" };

/**
 * Compose screen for a thread that doesn't exist yet.
 *
 * The conversation row is created by the first send rather than on arrival, so
 * opening someone's profile and backing out doesn't litter the inbox with
 * empty threads.
 */
export default async function NewMessagePage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { to } = await searchParams;
  if (!to) redirect("/messages");

  const profile = await gateway.profile.public({ userId: to });

  // Someone beat us to it (or the page was reloaded) — use the real thread.
  if (profile.conversationId) redirect(`/messages/${profile.conversationId}`);

  return (
    <>
      <PageHeader title="New message" />

      <Card className="mb-6 flex items-center gap-3 p-5">
        <Avatar name={profile.user.name} src={profile.user.avatarUrl} />
        <div className="min-w-0">
          <p className="truncate font-medium">{profile.user.name}</p>
          <p className="truncate text-sm text-[var(--muted-foreground)]">
            {profile.user.title ?? profile.user.location ?? ""}
          </p>
        </div>
      </Card>

      <ComposeFirstMessage recipientId={to} />
    </>
  );
}
