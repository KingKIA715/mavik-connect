import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, messagesTable, usersTable } from "@workspace/db";
import {
  ListMessagesResponseItem,
  SendMessageBody,
  SendMessageResponse,
  EditMessageBody,
  EditMessageResponse,
  DeleteMessageResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { parseGroupId, isGroupMember } from "../lib/groupAccess";
import { broadcastToGroup } from "../ws/hub";
import { toIso, toIsoOrNull } from "../lib/serialize";

const router: IRouter = Router();

router.use(requireAuth);

function parsePaginationQuery(query: Record<string, unknown>): {
  limit: number;
  offset: number;
} {
  const rawLimit = Number(query.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 100
      ? Math.floor(rawLimit)
      : 50;

  const rawOffset = Number(query.offset);
  const offset =
    Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;

  return { limit, offset };
}

router.get(
  "/groups/:groupId/messages",
  async (req, res): Promise<void> => {
    const groupId = parseGroupId(req.params.groupId);
    if (groupId === null) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const member = await isGroupMember(groupId, req.userId!);
    if (!member) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const { limit, offset } = parsePaginationQuery(req.query);

    const rows = await db
      .select({
        id: messagesTable.id,
        groupId: messagesTable.groupId,
        senderId: messagesTable.senderId,
        senderName: usersTable.name,
        senderAvatarUrl: usersTable.avatarUrl,
        content: messagesTable.content,
        type: messagesTable.type,
        fileName: messagesTable.fileName,
        mimeType: messagesTable.mimeType,
        fileSize: messagesTable.fileSize,
        createdAt: messagesTable.createdAt,
        editedAt: messagesTable.editedAt,
        deletedAt: messagesTable.deletedAt,
      })
      .from(messagesTable)
      .innerJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
      .where(eq(messagesTable.groupId, groupId))
      .orderBy(asc(messagesTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(
      rows.map((row) =>
        ListMessagesResponseItem.parse({
          ...row,
          id: String(row.id),
          groupId: String(row.groupId),
          createdAt: toIso(row.createdAt),
          editedAt: toIsoOrNull(row.editedAt),
          deletedAt: toIsoOrNull(row.deletedAt),
        }),
      ),
    );
  },
);

router.post(
  "/groups/:groupId/messages",
  async (req, res): Promise<void> => {
    const groupId = parseGroupId(req.params.groupId);
    if (groupId === null) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const userId = req.userId!;
    const member = await isGroupMember(groupId, userId);
    if (!member) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const parsed = SendMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [message] = await db
      .insert(messagesTable)
      .values({
        groupId,
        senderId: userId,
        content: parsed.data.content,
        type: parsed.data.type ?? "text",
        fileName: parsed.data.fileName ?? null,
        mimeType: parsed.data.mimeType ?? null,
        fileSize: parsed.data.fileSize ?? null,
      })
      .returning();

    const [sender] = await db
      .select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    const payload = SendMessageResponse.parse({
      id: String(message.id),
      groupId: String(message.groupId),
      senderId: message.senderId,
      senderName: sender?.name ?? "Family Member",
      senderAvatarUrl: sender?.avatarUrl ?? null,
      content: message.content,
      type: message.type,
      fileName: message.fileName,
      mimeType: message.mimeType,
      fileSize: message.fileSize,
      createdAt: toIso(message.createdAt),
      editedAt: null,
      deletedAt: null,
    });

    broadcastToGroup(groupId, { type: "message", message: payload });

    res.status(201).json(payload);
  },
);

router.patch(
  "/groups/:groupId/messages/:messageId",
  async (req, res): Promise<void> => {
    const groupId = parseGroupId(req.params.groupId);
    const messageId = parseGroupId(req.params.messageId);
    if (groupId === null || messageId === null) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const userId = req.userId!;
    const member = await isGroupMember(groupId, userId);
    if (!member) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(messagesTable)
      .where(
        and(eq(messagesTable.id, messageId), eq(messagesTable.groupId, groupId)),
      );
    if (!existing) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    if (existing.senderId !== userId) {
      res.status(403).json({ error: "You can only edit your own messages" });
      return;
    }
    if (existing.type !== "text" || existing.deletedAt) {
      res.status(403).json({ error: "This message can't be edited" });
      return;
    }

    const parsed = EditMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [updated] = await db
      .update(messagesTable)
      .set({ content: parsed.data.content, editedAt: new Date() })
      .where(eq(messagesTable.id, messageId))
      .returning();

    const [sender] = await db
      .select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    const payload = EditMessageResponse.parse({
      id: String(updated.id),
      groupId: String(updated.groupId),
      senderId: updated.senderId,
      senderName: sender?.name ?? "Family Member",
      senderAvatarUrl: sender?.avatarUrl ?? null,
      content: updated.content,
      type: updated.type,
      fileName: updated.fileName,
      mimeType: updated.mimeType,
      fileSize: updated.fileSize,
      createdAt: toIso(updated.createdAt),
      editedAt: toIsoOrNull(updated.editedAt),
      deletedAt: toIsoOrNull(updated.deletedAt),
    });

    broadcastToGroup(groupId, { type: "message-updated", message: payload });

    res.json(payload);
  },
);

router.delete(
  "/groups/:groupId/messages/:messageId",
  async (req, res): Promise<void> => {
    const groupId = parseGroupId(req.params.groupId);
    const messageId = parseGroupId(req.params.messageId);
    if (groupId === null || messageId === null) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const userId = req.userId!;
    const member = await isGroupMember(groupId, userId);
    if (!member) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(messagesTable)
      .where(
        and(eq(messagesTable.id, messageId), eq(messagesTable.groupId, groupId)),
      );
    if (!existing) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    if (existing.senderId !== userId) {
      res.status(403).json({ error: "You can only delete your own messages" });
      return;
    }

    const [updated] = await db
      .update(messagesTable)
      .set({
        content: "",
        fileName: null,
        mimeType: null,
        fileSize: null,
        deletedAt: new Date(),
      })
      .where(eq(messagesTable.id, messageId))
      .returning();

    const [sender] = await db
      .select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    const payload = DeleteMessageResponse.parse({
      id: String(updated.id),
      groupId: String(updated.groupId),
      senderId: updated.senderId,
      senderName: sender?.name ?? "Family Member",
      senderAvatarUrl: sender?.avatarUrl ?? null,
      content: updated.content,
      type: updated.type,
      fileName: updated.fileName,
      mimeType: updated.mimeType,
      fileSize: updated.fileSize,
      createdAt: toIso(updated.createdAt),
      editedAt: toIsoOrNull(updated.editedAt),
      deletedAt: toIsoOrNull(updated.deletedAt),
    });

    broadcastToGroup(groupId, { type: "message-updated", message: payload });

    res.json(payload);
  },
);

export default router;
