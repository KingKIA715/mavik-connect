import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, inArray, or } from "drizzle-orm";
import {
  db,
  dmKeysTable,
  dmMessagesTable,
  dmThreadsTable,
  usersTable,
} from "@workspace/db";
import {
  CreateDmThreadBody,
  CreateDmThreadResponse,
  GetDmThreadResponse,
  GetMyDmKeyResponse,
  ListDmMessagesResponseItem,
  ListDmThreadsResponseItem,
  SendDmMessageBody,
  SendDmMessageResponse,
  EditDmMessageBody,
  EditDmMessageResponse,
  DeleteDmMessageResponse,
  SetDmKeyBody,
  SetDmKeyResponse,
  MarkDmThreadReadResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { messageSendRateLimit } from "../middlewares/rateLimit";
import {
  parseThreadId,
  isThreadParticipant,
  findOrCreateThread,
  getReadTimestamps,
  myLastReadColumn,
} from "../lib/dmAccess";
import { broadcastToThread, sendToUserInThread } from "../ws/hub";
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

router.get("/dms", async (req, res): Promise<void> => {
  const userId = req.userId!;

  const threads = await db
    .select()
    .from(dmThreadsTable)
    .where(
      or(
        eq(dmThreadsTable.userAId, userId),
        eq(dmThreadsTable.userBId, userId),
      ),
    )
    .orderBy(desc(dmThreadsTable.createdAt));

  if (threads.length === 0) {
    res.json([]);
    return;
  }

  const otherUserIds = threads.map((t) =>
    t.userAId === userId ? t.userBId : t.userAId,
  );
  const otherUsers = await db
    .select()
    .from(usersTable)
    .where(inArray(usersTable.id, otherUserIds));
  const otherUserById = new Map(otherUsers.map((u) => [u.id, u]));

  const threadIds = threads.map((t) => t.id);
  const lastMessages = await db
    .select({
      threadId: dmMessagesTable.threadId,
      content: dmMessagesTable.content,
      createdAt: dmMessagesTable.createdAt,
    })
    .from(dmMessagesTable)
    .where(inArray(dmMessagesTable.threadId, threadIds))
    .orderBy(desc(dmMessagesTable.createdAt));
  const lastMessageByThread = new Map<
    number,
    { content: string; createdAt: Date }
  >();
  for (const row of lastMessages) {
    if (!lastMessageByThread.has(row.threadId)) {
      lastMessageByThread.set(row.threadId, {
        content: row.content,
        createdAt: row.createdAt,
      });
    }
  }

  const keyHolders = await db
    .select({ threadId: dmKeysTable.threadId, userId: dmKeysTable.userId })
    .from(dmKeysTable)
    .where(inArray(dmKeysTable.threadId, threadIds));
  const keyHolderSet = new Set(
    keyHolders.map((k) => `${k.threadId}:${k.userId}`),
  );

  // Unread badge count per thread: messages from the other participant
  // created after my last-read timestamp for that thread (never-read
  // threads count everything from them).
  const unreadCounts = await Promise.all(
    threads.map(async (thread) => {
      const otherUserId = thread.userAId === userId ? thread.userBId : thread.userAId;
      const { myLastReadAt } = getReadTimestamps(thread, userId);
      const rows = await db
        .select({ id: dmMessagesTable.id })
        .from(dmMessagesTable)
        .where(
          and(
            eq(dmMessagesTable.threadId, thread.id),
            eq(dmMessagesTable.senderId, otherUserId),
            myLastReadAt ? gt(dmMessagesTable.createdAt, myLastReadAt) : undefined,
          ),
        );
      return { threadId: thread.id, count: rows.length };
    }),
  );
  const unreadCountByThread = new Map(
    unreadCounts.map((u) => [u.threadId, u.count]),
  );

  const result = threads.map((thread) => {
    const otherUserId = thread.userAId === userId ? thread.userBId : thread.userAId;
    const otherUser = otherUserById.get(otherUserId);
    const lastMessage = lastMessageByThread.get(thread.id);
    const { myLastReadAt, otherLastReadAt } = getReadTimestamps(thread, userId);
    return {
      id: String(thread.id),
      otherUserId,
      otherUserName: otherUser?.name ?? "Unknown",
      otherUserEmail: otherUser?.email ?? "",
      otherUserAvatarUrl: otherUser?.avatarUrl ?? null,
      otherUserPublicKey: otherUser?.publicKey ?? null,
      otherUserHasEncryptionKey: keyHolderSet.has(`${thread.id}:${otherUserId}`),
      createdAt: toIso(thread.createdAt),
      lastMessageAt: toIsoOrNull(lastMessage?.createdAt),
      lastMessagePreview: lastMessage?.content ?? null,
      myLastReadAt: toIsoOrNull(myLastReadAt),
      otherUserLastReadAt: toIsoOrNull(otherLastReadAt),
      unreadCount: unreadCountByThread.get(thread.id) ?? 0,
    };
  });

  res.json(result.map((t) => ListDmThreadsResponseItem.parse(t)));
});

router.post("/dms", async (req, res): Promise<void> => {
  const parsed = CreateDmThreadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;

  const [otherUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, parsed.data.email));
  if (!otherUser) {
    res.status(404).json({ error: "User with that email not found" });
    return;
  }

  if (otherUser.id === userId) {
    res.status(400).json({ error: "Cannot start a DM thread with yourself" });
    return;
  }

  const thread = await findOrCreateThread(userId, otherUser.id);

  const [lastMessage] = await db
    .select({
      content: dmMessagesTable.content,
      createdAt: dmMessagesTable.createdAt,
    })
    .from(dmMessagesTable)
    .where(eq(dmMessagesTable.threadId, thread.id))
    .orderBy(desc(dmMessagesTable.createdAt))
    .limit(1);

  const [otherUserKey] = await db
    .select({ userId: dmKeysTable.userId })
    .from(dmKeysTable)
    .where(
      and(
        eq(dmKeysTable.threadId, thread.id),
        eq(dmKeysTable.userId, otherUser.id),
      ),
    );

  res.status(201).json(
    CreateDmThreadResponse.parse({
      id: String(thread.id),
      otherUserId: otherUser.id,
      otherUserName: otherUser.name,
      otherUserEmail: otherUser.email,
      otherUserAvatarUrl: otherUser.avatarUrl,
      otherUserPublicKey: otherUser.publicKey,
      otherUserHasEncryptionKey: Boolean(otherUserKey),
      createdAt: toIso(thread.createdAt),
      lastMessageAt: toIsoOrNull(lastMessage?.createdAt),
      lastMessagePreview: lastMessage?.content ?? null,
      myLastReadAt: toIsoOrNull(getReadTimestamps(thread, userId).myLastReadAt),
      otherUserLastReadAt: toIsoOrNull(
        getReadTimestamps(thread, userId).otherLastReadAt,
      ),
      unreadCount: 0,
    }),
  );
});

router.get("/dms/:threadId", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.threadId);
  if (threadId === null) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const userId = req.userId!;
  const participant = await isThreadParticipant(threadId, userId);
  if (!participant) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const [thread] = await db
    .select()
    .from(dmThreadsTable)
    .where(eq(dmThreadsTable.id, threadId));
  if (!thread) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const otherUserId = thread.userAId === userId ? thread.userBId : thread.userAId;
  const [otherUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, otherUserId));

  const [otherUserKey] = await db
    .select({ userId: dmKeysTable.userId })
    .from(dmKeysTable)
    .where(
      and(eq(dmKeysTable.threadId, threadId), eq(dmKeysTable.userId, otherUserId)),
    );

  const [lastMessage] = await db
    .select({
      content: dmMessagesTable.content,
      createdAt: dmMessagesTable.createdAt,
    })
    .from(dmMessagesTable)
    .where(eq(dmMessagesTable.threadId, threadId))
    .orderBy(desc(dmMessagesTable.createdAt))
    .limit(1);

  const { myLastReadAt, otherLastReadAt } = getReadTimestamps(thread, userId);
  const unreadRows = await db
    .select({ id: dmMessagesTable.id })
    .from(dmMessagesTable)
    .where(
      and(
        eq(dmMessagesTable.threadId, threadId),
        eq(dmMessagesTable.senderId, otherUserId),
        myLastReadAt ? gt(dmMessagesTable.createdAt, myLastReadAt) : undefined,
      ),
    );

  res.json(
    GetDmThreadResponse.parse({
      id: String(thread.id),
      otherUserId,
      otherUserName: otherUser?.name ?? "Unknown",
      otherUserEmail: otherUser?.email ?? "",
      otherUserAvatarUrl: otherUser?.avatarUrl ?? null,
      otherUserPublicKey: otherUser?.publicKey ?? null,
      otherUserHasEncryptionKey: Boolean(otherUserKey),
      createdAt: toIso(thread.createdAt),
      lastMessageAt: toIsoOrNull(lastMessage?.createdAt),
      lastMessagePreview: lastMessage?.content ?? null,
      myLastReadAt: toIsoOrNull(myLastReadAt),
      otherUserLastReadAt: toIsoOrNull(otherLastReadAt),
      unreadCount: unreadRows.length,
    }),
  );
});

router.delete("/dms/:threadId", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.threadId);
  if (threadId === null) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const userId = req.userId!;
  const member = await isThreadParticipant(threadId, userId);
  if (!member) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  // Notify the other participant, if currently connected, before the row
  // (and its cascading messages/keys) disappears out from under them —
  // mirrors deleteGroup's "group-deleted" broadcast.
  broadcastToThread(threadId, { type: "dm-thread-deleted", threadId: String(threadId) });

  await db.delete(dmThreadsTable).where(eq(dmThreadsTable.id, threadId));

  res.sendStatus(204);
});

router.put("/dms/:threadId/read", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.threadId);
  if (threadId === null) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const userId = req.userId!;
  const [thread] = await db
    .select()
    .from(dmThreadsTable)
    .where(eq(dmThreadsTable.id, threadId));
  if (!thread || (thread.userAId !== userId && thread.userBId !== userId)) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const now = new Date();
  const column = myLastReadColumn(thread, userId);
  await db
    .update(dmThreadsTable)
    .set({ [column]: now })
    .where(eq(dmThreadsTable.id, threadId));

  // Let the other participant know live, if they're currently viewing this
  // thread, so their "Seen" receipt updates without a reload.
  broadcastToThread(threadId, { type: "read", userId, lastReadAt: toIso(now) });

  res.json(MarkDmThreadReadResponse.parse({ lastReadAt: toIso(now) }));
});

router.get("/dms/:threadId/key", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.threadId);
  if (threadId === null) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const userId = req.userId!;
  const participant = await isThreadParticipant(threadId, userId);
  if (!participant) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const [key] = await db
    .select({ wrappedKey: dmKeysTable.wrappedKey })
    .from(dmKeysTable)
    .where(
      and(eq(dmKeysTable.threadId, threadId), eq(dmKeysTable.userId, userId)),
    );

  res.json(
    GetMyDmKeyResponse.parse({
      threadId: String(threadId),
      wrappedKey: key?.wrappedKey ?? null,
    }),
  );
});

router.post("/dms/:threadId/keys", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.threadId);
  if (threadId === null) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const requesterId = req.userId!;
  const requesterIsParticipant = await isThreadParticipant(
    threadId,
    requesterId,
  );
  if (!requesterIsParticipant) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const parsed = SetDmKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const targetIsParticipant = await isThreadParticipant(
    threadId,
    parsed.data.userId,
  );
  if (!targetIsParticipant) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  await db
    .insert(dmKeysTable)
    .values({
      threadId,
      userId: parsed.data.userId,
      wrappedKey: parsed.data.wrappedKey,
    })
    .onConflictDoUpdate({
      target: [dmKeysTable.threadId, dmKeysTable.userId],
      set: { wrappedKey: parsed.data.wrappedKey },
    });

  // Tell the recipient's client (if connected to this thread) that a key is
  // now available, so it can refetch instead of staying stuck on "missing"
  // until they happen to reload the page. See dmAccess/key-rotation notes in
  // users.ts for why this handshake matters after a public-key rotation.
  sendToUserInThread(threadId, parsed.data.userId, { type: "dm-key-ready" });

  res.status(201).json(
    SetDmKeyResponse.parse({
      threadId: String(threadId),
      wrappedKey: parsed.data.wrappedKey,
    }),
  );
});

router.get("/dms/:threadId/messages", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.threadId);
  if (threadId === null) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const member = await isThreadParticipant(threadId, req.userId!);
  if (!member) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const { limit, offset } = parsePaginationQuery(req.query);

  const rows = await db
    .select({
      id: dmMessagesTable.id,
      threadId: dmMessagesTable.threadId,
      senderId: dmMessagesTable.senderId,
      senderName: usersTable.name,
      senderAvatarUrl: usersTable.avatarUrl,
      content: dmMessagesTable.content,
      type: dmMessagesTable.type,
      fileName: dmMessagesTable.fileName,
      mimeType: dmMessagesTable.mimeType,
      fileSize: dmMessagesTable.fileSize,
      createdAt: dmMessagesTable.createdAt,
      editedAt: dmMessagesTable.editedAt,
      deletedAt: dmMessagesTable.deletedAt,
    })
    .from(dmMessagesTable)
    .innerJoin(usersTable, eq(dmMessagesTable.senderId, usersTable.id))
    .where(eq(dmMessagesTable.threadId, threadId))
    .orderBy(asc(dmMessagesTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(
    rows.map((row) =>
      ListDmMessagesResponseItem.parse({
        ...row,
        id: String(row.id),
        threadId: String(row.threadId),
        createdAt: toIso(row.createdAt),
        editedAt: toIsoOrNull(row.editedAt),
        deletedAt: toIsoOrNull(row.deletedAt),
      }),
    ),
  );
});

router.post("/dms/:threadId/messages", messageSendRateLimit, async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.threadId);
  if (threadId === null) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const userId = req.userId!;
  const member = await isThreadParticipant(threadId, userId);
  if (!member) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const parsed = SendDmMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [message] = await db
    .insert(dmMessagesTable)
    .values({
      threadId,
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

  const payload = SendDmMessageResponse.parse({
    id: String(message.id),
    threadId: String(message.threadId),
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

  broadcastToThread(threadId, { type: "message", message: payload });

  res.status(201).json(payload);
});

router.patch(
  "/dms/:threadId/messages/:messageId",
  async (req, res): Promise<void> => {
    const threadId = parseThreadId(req.params.threadId);
    const messageId = parseThreadId(req.params.messageId);
    if (threadId === null || messageId === null) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const userId = req.userId!;
    const member = await isThreadParticipant(threadId, userId);
    if (!member) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(dmMessagesTable)
      .where(
        and(
          eq(dmMessagesTable.id, messageId),
          eq(dmMessagesTable.threadId, threadId),
        ),
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

    const parsed = EditDmMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [updated] = await db
      .update(dmMessagesTable)
      .set({ content: parsed.data.content, editedAt: new Date() })
      .where(eq(dmMessagesTable.id, messageId))
      .returning();

    const [sender] = await db
      .select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    const payload = EditDmMessageResponse.parse({
      id: String(updated.id),
      threadId: String(updated.threadId),
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

    broadcastToThread(threadId, { type: "message-updated", message: payload });

    res.json(payload);
  },
);

router.delete(
  "/dms/:threadId/messages/:messageId",
  async (req, res): Promise<void> => {
    const threadId = parseThreadId(req.params.threadId);
    const messageId = parseThreadId(req.params.messageId);
    if (threadId === null || messageId === null) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const userId = req.userId!;
    const member = await isThreadParticipant(threadId, userId);
    if (!member) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const [existing] = await db
      .select()
      .from(dmMessagesTable)
      .where(
        and(
          eq(dmMessagesTable.id, messageId),
          eq(dmMessagesTable.threadId, threadId),
        ),
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
      .update(dmMessagesTable)
      .set({
        content: "",
        fileName: null,
        mimeType: null,
        fileSize: null,
        deletedAt: new Date(),
      })
      .where(eq(dmMessagesTable.id, messageId))
      .returning();

    const [sender] = await db
      .select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    const payload = DeleteDmMessageResponse.parse({
      id: String(updated.id),
      threadId: String(updated.threadId),
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

    broadcastToThread(threadId, { type: "message-updated", message: payload });

    res.json(payload);
  },
);

export default router;
