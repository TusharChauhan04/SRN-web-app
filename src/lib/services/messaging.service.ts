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

/**
 * Swaps each attachment's stored KEY for a freshly signed URL.
 *
 * `Message.attachmentUrl` holds the storage key, not a URL, and that is
 * deliberate: chat files live in the private bucket and are read through signed
 * URLs that expire after fifteen minutes. Storing the signed URL would mean
 * every attachment in the app broke a quarter of an hour after it was sent,
 * and worked perfectly in any test written in that window.
 *
 * Minting here is also what authorises the read. Every caller reaches this
 * through `getThread`, which has already run `assertParticipant`, so a URL is
 * only ever produced for someone entitled to the conversation. There is no
 * separate read route to guard, and no key to guess: the signature is scoped to
 * one object and expires on its own.
 *
 * One signing call per attachment, and only for messages that have one — a
 * thread of plain text costs nothing.
 */
async function withAttachmentUrls(messages: Message[]): Promise<Message[]> {
  if (!messages.some((m) => m.attachmentUrl)) return messages;

  const { storageProvider } = await import(
    "@/lib/providers/storage/index.server"
  );
  const provider = storageProvider();

  return Promise.all(
    messages.map(async (message) => {
      if (!message.attachmentUrl) return message;
      try {
        return {
          ...message,
          attachmentUrl: await provider.getReadUrl(message.attachmentUrl, "chat"),
        };
      } catch (err) {
        // A file we cannot sign is a broken attachment, not a broken thread.
        // The message text still matters, so the conversation renders without
        // it rather than failing outright.
        console.error("[messaging] could not sign attachment:", err);
        return { ...message, attachmentUrl: null };
      }
    }),
  );
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

  /*
   * Reading a thread marks it read, as on mobile — but only when there is
   * something to mark.
   *
   * This ran unconditionally, so a poll every 5 seconds issued a WRITE on a
   * read path whether or not any row matched: ~12 write transactions per minute
   * per open tab, doing nothing. On SQLite, where there is one writer at a
   * time, that put idle chat tabs in front of real traffic.
   */
  const hasUnreadInbound = page.items.some(
    (m) => m.receiverId === actor.id && !m.read,
  );
  if (hasUnreadInbound) {
    await repo.messages.markConversationRead(conversationId, actor.id);
  }

  return {
    conversation,
    messages: await withAttachmentUrls(page.items),
    counterpart: other
      ? { id: other.id, name: other.name, avatarUrl: other.avatarUrl ?? null }
      : null,
    counterpartOnline: presence?.isOnline ?? false,
  };
}

/**
 * Resolves an upload id into the three columns a message stores.
 *
 * Every check here is one a caller could otherwise bypass by posting an id
 * that is not theirs: the upload must exist, belong to the sender, be a chat
 * upload rather than someone's identity document, and have been confirmed —
 * an unconfirmed row means the bytes were never verified to have landed.
 */
async function resolveAttachment(
  actor: User,
  uploadId: string,
): Promise<{ url: string; name: string; size: string }> {
  const upload = await repo.uploads.findById(uploadId);

  if (!upload || upload.userId !== actor.id) {
    throw GatewayError.notFound("That file doesn't exist.");
  }
  if (upload.context !== "chat") {
    throw GatewayError.validation("That file wasn't uploaded for a message.");
  }
  if (!upload.confirmed) {
    throw GatewayError.validation("That file hasn't finished uploading.");
  }

  // The KEY, not a URL — see withAttachmentUrls above.
  return {
    url: upload.storageKey,
    name: upload.fileName,
    size: String(upload.sizeBytes),
  };
}

export async function sendMessage(
  actor: User,
  input: {
    recipientId: string;
    text: string;
    conversationId?: string;
    attachmentUploadId?: string;
  },
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

  /*
   * Resolved BEFORE the row is written, so a bad upload id rejects the whole
   * send. Writing the message first and attaching afterwards would leave a
   * message the sender believes carries a file and does not.
   */
  const attachment = input.attachmentUploadId
    ? await resolveAttachment(actor, input.attachmentUploadId)
    : null;

  const { message } = await repo.messages.send({
    senderId: actor.id,
    receiverId: input.recipientId,
    text: input.text,
    conversationId: input.conversationId,
    ...(attachment && {
      attachmentUrl: attachment.url,
      attachmentName: attachment.name,
      attachmentSize: attachment.size,
    }),
  });

  await notify({
      userId: input.recipientId,
      type: "message",
      title: "New message",
      body: attachment
        ? `${actor.name} sent you a file.`
        : `${actor.name} sent you a message.`,
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
