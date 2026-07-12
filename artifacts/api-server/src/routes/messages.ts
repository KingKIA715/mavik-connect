import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, messagesTable, usersTable } from "@workspace/db";
import {
  ListMessagesResponseItem,
  SendMessageBody,
  SendMessageResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { parseGroupId, isGroupMember } from "../lib/groupAccess";
import { broadcastToGroup } from "../ws/hub";
import { toIso } from "../lib/serialize";

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
    });

    broadcastToGroup(groupId, { type: "message", message: payload });

    res.status(201).json(payload);
  },
);

export default router;
