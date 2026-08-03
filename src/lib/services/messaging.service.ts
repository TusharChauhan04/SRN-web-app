import "server-only";

/**
 * Chat policy.
 *
 * Chat is REST-polled, matching mobile exactly — there is no realtime listener
 * to port. See WEB_MIGRATION_PLAN.md §0.1 for the evidence.
 */
import { repo } from "@/lib/repositories";
import { notify } from "./notify.service";
import type { Conversation, Message, User } from "@/lib/repositories/types";
import { GatewayError } from "@/lib/gateway/types";

/** Poll cadences ported from mobile's ChatScreen. */
export const MESSAGE_POLL_MS = 5_000;
export const PRESENCE_POLL_MS = 30_000;

export async function listConversations(
  actor: User,
  params: { limit?: number; offset?: number } = {},
) {
  return repo.messages.listConversations(actor.id, params);
}

/** Throws unless the caller is a participant. */
async function assertParticipant(
  actor: User,
  conversationId: string,
): Promise<Conversation> {
  const conversation = await repo.messages.findConversationById(conversationId);
  if (!conversation) throw GatewayError.notFound("Conversation not found");

  if (!conversation.participantIds.includes(actor.id)) {
    // notFound, not forbidden — otherwise conversation ids are enumerable.
    throw GatewayError.notFound("Conversation not found");
  }
  return conversation;
}

export interface ThreadView {
  conversation: Conversation;
  messages: Message[];
  counterpart: { id: string; name: string; avatarUrl: string | null } | null;
  counterpartOnline: boolean;
}

export async function getThread(
  actor: User,
  conversationId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<ThreadView> {
  const conversation = await assertParticipant(actor, conversationId);

  const otherId =
    conversation.participantIds.find((id) => id !== actor.id) ?? null;

  const [page, other, presence] = await Promise.all([
    repo.messages.listMessages(conversationId, { limit: 100, ...params }),
    otherId ? repo.users.findById(otherId) : Promise.resolve(null),
    otherId ? repo.presence.get(otherId) : Promise.resolve(null),
  ]);

  // Reading a thread marks it read, as on mobile.
  await repo.messages.markConversationRead(conversationId, actor.id);

  return {
    conversation,
    messages: page.items,
    counterpart: other
      ? { id: other.id, name: other.name, avatarUrl: other.avatarUrl ?? null }
      : null,
    counterpartOnline: presence?.isOnline ?? false,
  };
}

export async function sendMessage(
  actor: User,
  input: { recipientId: string; text: string; conversationId?: string },
): Promise<Message> {
  if (input.recipientId === actor.id) {
    throw GatewayError.validation("You can't message yourself.");
  }

  const recipient = await repo.users.findById(input.recipientId);
  if (!recipient) throw GatewayError.notFound("That user doesn't exist.");

  // Blocking is symmetric for delivery — either direction stops the message.
  const blocked = await repo.moderation.isBlocked(actor.id, input.recipientId);
  if (blocked) {
    throw GatewayError.forbidden("You can't message this person.");
  }

  if (input.conversationId) {
    const conversation = await assertParticipant(actor, input.conversationId);

    /*
     * The recipient must be a participant of THIS thread.
     *
     * Checking "sender is a participant" and "sender hasn't been blocked by
     * recipientId" separately left a gap, because nothing tied the two
     * arguments together. After B blocks A, A still has the A↔B thread id — so
     * A could send with `conversationId` = the A↔B thread and `recipientId` =
     * some third party who hasn't blocked them. The block check passed (wrong
     * pair), the participant check passed (A is in that thread), and the
     * message landed in B's conversation with the preview on B's list. The
     * block was bypassed.
     */
    if (!conversation.participantIds.includes(input.recipientId)) {
      throw GatewayError.validation(
        "That recipient isn't part of this conversation.",
      );
    }
  }

  const { message } = await repo.messages.send({
    senderId: actor.id,
    receiverId: input.recipientId,
    text: input.text,
    conversationId: input.conversationId,
  });

  await notify({
      userId: input.recipientId,
      type: "message",
      title: "New message",
      body: `${actor.name} sent you a message.`,
      data: { conversationId: message.conversationId },
    });

  return message;
}

/** Opens (or finds) the thread with another user, for "Message provider". */
export async function openConversationWith(
  actor: User,
  otherUserId: string,
): Promise<Conversation | null> {
  if (otherUserId === actor.id) {
    throw GatewayError.validation("You can't message yourself.");
  }
  return repo.messages.findConversationBetween(actor.id, otherUserId);
}

export async function deleteMessage(
  actor: User,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await assertParticipant(actor, conversationId);

  // By id, not by scanning a page: the page is bounded, so scanning it made
  // messages beyond the limit undeletable.
  const message = await repo.messages.findMessageById(conversationId, messageId);
  if (!message) throw GatewayError.notFound("Message not found");
  if (message.senderId !== actor.id) {
    throw GatewayError.forbidden("You can only delete your own messages.");
  }

  await repo.messages.deleteMessage(conversationId, messageId);
}

/** Heartbeat, so the other side sees an online indicator. */
export async function recordPresence(actor: User): Promise<void> {
  await repo.presence.heartbeat(actor.id);
}
