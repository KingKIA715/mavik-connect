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

const router: IRouter = Router();

router.use(requireAuth);

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

    const rows = await db
      .select({
        id: messagesTable.id,
        groupId: messagesTable.groupId,
        senderId: messagesTable.senderId,
        senderName: usersTable.name,
        senderAvatarUrl: usersTable.avatarUrl,
        content: messagesTable.content,
        createdAt: messagesTable.createdAt,
      })
      .from(messagesTable)
      .innerJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
      .where(eq(messagesTable.groupId, groupId))
      .orderBy(asc(messagesTable.createdAt));

    res.json(
      rows.map((row) =>
        ListMessagesResponseItem.parse({
          ...row,
          id: String(row.id),
          groupId: String(row.groupId),
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
      .values({ groupId, senderId: userId, content: parsed.data.content })
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
      createdAt: message.createdAt,
    });

    broadcastToGroup(groupId, { type: "message", message: payload });

    res.status(201).json(payload);
  },
);

export default router;
