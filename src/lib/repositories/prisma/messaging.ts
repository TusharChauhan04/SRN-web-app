import { prisma } from "@/lib/db/client";
import type { MessageRepository, SendMessageInput } from "../interfaces";
import {
  normalizePageParams,
  type Conversation,
  type Message,
  type Page,
  type PageParams,
} from "../types";
import { conversationKey, toConversation, toMessage } from "./mappers";

/**
 * Chat is REST-polled, exactly as the mobile app does it — there is no realtime
 * listener to port. See WEB_MIGRATION_PLAN.md §0.1 for the evidence behind that
 * decision; the audit that suggested Firestore onSnapshot was wrong.
 */
export class PrismaMessageRepository implements MessageRepository {
  async send(input: SendMessageInput): Promise<{
    message: Message;
    conversation: Conversation;
  }> {
    const key = conversationKey(input.senderId, input.receiverId);

    // Resolve the thread by explicit id when given, else by participant key.
    let convRow = input.conversationId
      ? await prisma.conversation.findUnique({
          where: { id: input.conversationId },
        })
      : await prisma.conversation.findFirst({
          where: { participantIds: key },
        });

    convRow ??= await prisma.conversation.create({
      data: { participantIds: key, lastMessageText: input.text },
    });

    const [messageRow, updatedConv] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: convRow.id,
          senderId: input.senderId,
          receiverId: input.receiverId,
          text: input.text,
          attachmentUrl: input.attachmentUrl ?? null,
          attachmentName: input.attachmentName ?? null,
          attachmentSize: input.attachmentSize ?? null,
          quoteId: input.quoteId ?? null,
        },
      }),
      prisma.conversation.update({
        where: { id: convRow.id },
        data: { lastMessageAt: new Date(), lastMessageText: input.text },
      }),
    ]);

    return {
      message: toMessage(messageRow),
      conversation: toConversation(updatedConv),
    };
  }

  async listConversations(
    userId: string,
    params: PageParams = {},
  ): Promise<Page<Conversation>> {
    const { limit, offset } = normalizePageParams(params);

    // participantIds is a comma-joined sorted pair, so a substring match on the
    // uid finds every thread the user is in. Postgres would use an array column
    // with a containment operator instead.
    const where = { participantIds: { contains: userId } };

    const [rows, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.conversation.count({ where }),
    ]);

    // Resolve the counterpart and unread count for each thread in one pass.
    const conversations = rows.map(toConversation);
    const counterpartIds = conversations
      .map((c) => c.participantIds.find((p) => p !== userId))
      .filter((id): id is string => Boolean(id));

    const [counterparts, unreadCounts] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: counterpartIds } },
        select: { id: true, name: true, avatarUrl: true },
      }),
      prisma.message.groupBy({
        by: ["conversationId"],
        where: {
          conversationId: { in: conversations.map((c) => c.id) },
          receiverId: userId,
          read: false,
        },
        _count: { _all: true },
      }),
    ]);

    const byId = new Map(counterparts.map((u) => [u.id, u]));
    const unreadByConv = new Map(
      unreadCounts.map((u) => [u.conversationId, u._count._all]),
    );

    for (const c of conversations) {
      const otherId = c.participantIds.find((p) => p !== userId);
      c.counterpart = otherId ? (byId.get(otherId) ?? null) : null;
      c.unreadCount = unreadByConv.get(c.id) ?? 0;
    }

    return { items: conversations, total, limit, offset };
  }

  async findConversationById(id: string): Promise<Conversation | null> {
    const row = await prisma.conversation.findUnique({ where: { id } });
    return row ? toConversation(row) : null;
  }

  async findConversationBetween(
    userIdA: string,
    userIdB: string,
  ): Promise<Conversation | null> {
    const row = await prisma.conversation.findFirst({
      where: { participantIds: conversationKey(userIdA, userIdB) },
    });
    return row ? toConversation(row) : null;
  }

  async listMessages(
    conversationId: string,
    params: PageParams = {},
  ): Promise<Page<Message>> {
    const { limit, offset } = normalizePageParams(params);
    const where = { conversationId, isDeleted: false };

    const [rows, total] = await Promise.all([
      prisma.message.findMany({
        where,
        orderBy: { createdAt: "asc" },
        take: limit,
        skip: offset,
      }),
      prisma.message.count({ where }),
    ]);

    return { items: rows.map(toMessage), total, limit, offset };
  }

  async markConversationRead(
    conversationId: string,
    readerId: string,
  ): Promise<void> {
    // Only the recipient's own inbound messages flip to read.
    await prisma.message.updateMany({
      where: { conversationId, receiverId: readerId, read: false },
      data: { read: true },
    });
  }

  async deleteMessage(
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    // Soft delete: the row stays so moderation and audit history survive.
    await prisma.message.updateMany({
      where: { id: messageId, conversationId },
      data: { isDeleted: true },
    });
  }

  async listFlagged(params: PageParams = {}): Promise<Page<Message>> {
    const { limit, offset } = normalizePageParams(params);
    const where = { isFlagged: true };

    const [rows, total] = await Promise.all([
      prisma.message.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.message.count({ where }),
    ]);

    return { items: rows.map(toMessage), total, limit, offset };
  }

  async clearFlag(messageId: string): Promise<Message> {
    const row = await prisma.message.update({
      where: { id: messageId },
      data: { isFlagged: false },
    });
    return toMessage(row);
  }

  countUnread(userId: string): Promise<number> {
    return prisma.message.count({
      where: { receiverId: userId, read: false, isDeleted: false },
    });
  }
}
