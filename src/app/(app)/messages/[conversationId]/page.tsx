import { notFound, redirect } from "next/navigation";
import { gateway, GatewayError } from "@/lib/gateway";
import { getCurrentUser } from "@/lib/auth/session";
import { ChatThread } from "./ChatThread";

export const metadata = { title: "Chat — SRN" };

/**
 * Ported from mobile src/screens/shared/ChatScreen.tsx.
 *
 * The first render is server-side so the thread is there on load; the client
 * component then polls, matching mobile's behaviour exactly.
 */
export default async function ChatPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { conversationId } = await params;

  let thread;
  try {
    thread = await gateway.messages.thread({ conversationId });
  } catch (err) {
    if (err instanceof GatewayError && err.code === "not_found") notFound();
    throw err;
  }

  return (
    <ChatThread
      conversationId={conversationId}
      currentUserId={user.id}
      initialMessages={thread.messages}
      counterpart={thread.counterpart}
      initiallyOnline={thread.counterpartOnline}
    />
  );
}
