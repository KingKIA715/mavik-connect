import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt, inArray, or } from "drizzle-orm";
import {
  db,
  dmKeysTable,
  dmMessagesTable,
  dmMessageReactionsTable,
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
  SetDmThreadPinnedBody,
  SetDmThreadPinnedResponse,
  SetDmThreadMutedBody,
  SetDmThreadMutedResponse,
  RespondToDmThreadBody,
  RespondToDmThreadResponse,
  ToggleDmMessageReactionBody,
  ToggleDmMessageReactionResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import {
  messageSendRateLimit,
  keyRequestRateLimit,
} from "../middlewares/rateLimit";
import {
  parseThreadId,
  isThreadParticipant,
  findOrCreateThread,
  threadExistsBetween,
  countPendingOutboundRequests,
  MAX_PENDING_OUTBOUND_REQUESTS,
  getReadTimestamps,
  myLastReadColumn,
  myPinnedColumn,
  myPinnedAt,
  myMutedColumn,
  myMutedAt,
  canSendDm,
} from "../lib/dmAccess";
import { broadcastToThread, sendToUserInThread } from "../ws/hub";
import { toIso, toIsoOrNull } from "../lib/serialize";

const router: IRouter = Router();

router.use(requireAuth);

/**
 * Same aggregation as messages.ts's getReactionsByMessageId, over DM
 * message reactions instead of group ones.
 */
async function getDmReactionsByMessageId(
  messageIds: number[],
): Promise<Map<number, { emoji: string; userIds: string[] }[]>> {
  if (messageIds.length === 0) return new Map();

  const rows = await db
    .select({
      messageId: dmMessageReactionsTable.dmMessageId,
      userId: dmMessageReactionsTable.userId,
      emoji: dmMessageReactionsTable.emoji,
    })
    .from(dmMessageReactionsTable)
    .where(inArray(dmMessageReactionsTable.dmMessageId, messageIds));

  const byMessage = new Map<number, Map<string, string[]>>();
  for (const row of rows) {
    const byEmoji = byMessage.get(row.messageId) ?? new Map<string, string[]>();
    byEmoji.set(row.emoji, [...(byEmoji.get(row.emoji) ?? []), row.userId]);
    byMessage.set(row.messageId, byEmoji);
  }

  const result = new Map<number, { emoji: string; userIds: string[] }[]>();
  for (const [messageId, byEmoji] of byMessage) {
    result.set(
      messageId,
      Array.from(byEmoji.entries()).map(([emoji, userIds]) => ({
        emoji,
        userIds,
      })),
    );
  }
  return result;
}

/**
 * Same idea as messages.ts's getReplyPreviewsByReplyToId, over dm_messages.
 */
async function getDmReplyPreviewsByReplyToId(replyToIds: number[]): Promise<
  Map<
    number,
    {
      id: string;
      senderId: string;
      senderName: string;
      content: string;
      type: string;
      fileName: string | null;
      deletedAt: string | null;
    }
  >
> {
  const uniqueIds = [...new Set(replyToIds)];
  if (uniqueIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: dmMessagesTable.id,
      senderId: dmMessagesTable.senderId,
      senderName: usersTable.name,
      content: dmMessagesTable.content,
      type: dmMessagesTable.type,
      fileName: dmMessagesTable.fileName,
      deletedAt: dmMessagesTable.deletedAt,
    })
    .from(dmMessagesTable)
    .innerJoin(usersTable, eq(dmMessagesTable.senderId, usersTable.id))
    .where(inArray(dmMessagesTable.id, uniqueIds));

  const result = new Map<
    number,
    {
      id: string;
      senderId: string;
      senderName: string;
      content: string;
      type: string;
      fileName: string | null;
      deletedAt: string | null;
    }
  >();
  for (const row of rows) {
    result.set(row.id, {
      id: String(row.id),
      senderId: row.senderId,
      senderName: row.senderName,
      content: row.deletedAt ? "" : row.content,
      type: row.type,
      fileName: row.deletedAt ? null : row.fileName,
      deletedAt: toIsoOrNull(row.deletedAt),
    });
  }
  return result;
}

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
      const otherUserId =
        thread.userAId === userId ? thread.userBId : thread.userAId;
      const { myLastReadAt } = getReadTimestamps(thread, userId);
      const rows = await db
        .select({ id: dmMessagesTable.id })
        .from(dmMessagesTable)
        .where(
          and(
            eq(dmMessagesTable.threadId, thread.id),
            eq(dmMessagesTable.senderId, otherUserId),
            myLastReadAt
              ? gt(dmMessagesTable.createdAt, myLastReadAt)
              : undefined,
          ),
        );
      return { threadId: thread.id, count: rows.length };
    }),
  );
  const unreadCountByThread = new Map(
    unreadCounts.map((u) => [u.threadId, u.count]),
  );

  const result = threads.map((thread) => {
    const otherUserId =
      thread.userAId === userId ? thread.userBId : thread.userAId;
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
      otherUserHasEncryptionKey: keyHolderSet.has(
        `${thread.id}:${otherUserId}`,
      ),
      createdAt: toIso(thread.createdAt),
      lastMessageAt: toIsoOrNull(lastMessage?.createdAt),
      lastMessagePreview: lastMessage?.content ?? null,
      myLastReadAt: toIsoOrNull(myLastReadAt),
      otherUserLastReadAt: toIsoOrNull(otherLastReadAt),
      unreadCount: unreadCountByThread.get(thread.id) ?? 0,
      status: thread.status,
      isInitiatedByMe: thread.initiatorId === userId,
      isPinned: !!myPinnedAt(thread, userId),
      isMuted: !!myMutedAt(thread, userId),
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

  // Only cap *new* message requests — reopening/re-fetching a thread that
  // already exists (any status) is never blocked here.
  if (!(await threadExistsBetween(userId, otherUser.id))) {
    const pendingCount = await countPendingOutboundRequests(userId);
    if (pendingCount >= MAX_PENDING_OUTBOUND_REQUESTS) {
      res.status(429).json({
        error:
          "You have too many pending message requests waiting on a response. Try again once some have been accepted or declined.",
      });
      return;
    }
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
      status: thread.status,
      isInitiatedByMe: thread.initiatorId === userId,
      isPinned: !!myPinnedAt(thread, userId),
      isMuted: !!myMutedAt(thread, userId),
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

  const otherUserId =
    thread.userAId === userId ? thread.userBId : thread.userAId;
  const [otherUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, otherUserId));

  const [otherUserKey] = await db
    .select({ userId: dmKeysTable.userId })
    .from(dmKeysTable)
    .where(
      and(
        eq(dmKeysTable.threadId, threadId),
        eq(dmKeysTable.userId, otherUserId),
      ),
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
      status: thread.status,
      isInitiatedByMe: thread.initiatorId === userId,
      isPinned: !!myPinnedAt(thread, userId),
      isMuted: !!myMutedAt(thread, userId),
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
  broadcastToThread(threadId, {
    type: "dm-thread-deleted",
    threadId: String(threadId),
  });

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

router.put("/dms/:threadId/pin", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.threadId);
  if (threadId === null) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const parsed = SetDmThreadPinnedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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

  // Purely personal, like read receipts — only ever touches "my" pinned
  // column, never broadcast to the other participant.
  const column = myPinnedColumn(thread, userId);
  await db
    .update(dmThreadsTable)
    .set({ [column]: parsed.data.pinned ? new Date() : null })
    .where(eq(dmThreadsTable.id, threadId));

  res.json(SetDmThreadPinnedResponse.parse({ isPinned: parsed.data.pinned }));
});

router.put("/dms/:threadId/mute", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.threadId);
  if (threadId === null) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const parsed = SetDmThreadMutedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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

  // Purely personal, like pinning — only ever touches "my" muted column,
  // never broadcast to the other participant.
  const column = myMutedColumn(thread, userId);
  await db
    .update(dmThreadsTable)
    .set({ [column]: parsed.data.muted ? new Date() : null })
    .where(eq(dmThreadsTable.id, threadId));

  res.json(SetDmThreadMutedResponse.parse({ isMuted: parsed.data.muted }));
});

router.put("/dms/:threadId/respond", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.threadId);
  if (threadId === null) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const parsed = RespondToDmThreadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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

  // Only the recipient of a still-pending request can accept/reject it —
  // not the initiator (they can't accept/reject their own request), and
  // not once it's already been responded to.
  if (thread.status !== "pending") {
    res
      .status(409)
      .json({ error: "This message request has already been responded to." });
    return;
  }
  if (thread.initiatorId === userId) {
    res
      .status(403)
      .json({ error: "You can't accept or reject your own message request." });
    return;
  }

  const [updated] = await db
    .update(dmThreadsTable)
    .set({ status: parsed.data.action === "accept" ? "accepted" : "rejected" })
    .where(eq(dmThreadsTable.id, threadId))
    .returning();

  // Let the initiator know live, if connected, so their UI updates (e.g.
  // enabling/disabling their composer) without a reload.
  broadcastToThread(threadId, {
    type: "dm-request-responded",
    threadId: String(threadId),
    status: updated.status,
  });

  res.json(RespondToDmThreadResponse.parse({ status: updated.status }));
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

router.post(
  "/dms/:threadId/keys/request",
  keyRequestRateLimit,
  async (req, res): Promise<void> => {
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

    // Best-effort nudge: if the other participant is currently connected to
    // this thread and already holds the decrypted key, their client
    // re-shares it for requesterId. No-op if they're not currently online.
    broadcastToThread(threadId, { type: "dm-key-requested", requesterId });

    res.status(202).end();
  },
);

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
      durationSeconds: dmMessagesTable.durationSeconds,
      replyToId: dmMessagesTable.replyToId,
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

  const reactionsByMessageId = await getDmReactionsByMessageId(
    rows.map((r) => r.id),
  );
  const replyPreviewsByReplyToId = await getDmReplyPreviewsByReplyToId(
    rows.flatMap((r) => (r.replyToId ? [r.replyToId] : [])),
  );

  res.json(
    rows.map((row) =>
      ListDmMessagesResponseItem.parse({
        ...row,
        id: String(row.id),
        threadId: String(row.threadId),
        replyToId: row.replyToId ? String(row.replyToId) : null,
        replyTo: row.replyToId
          ? (replyPreviewsByReplyToId.get(row.replyToId) ?? null)
          : null,
        createdAt: toIso(row.createdAt),
        editedAt: toIsoOrNull(row.editedAt),
        deletedAt: toIsoOrNull(row.deletedAt),
        reactions: reactionsByMessageId.get(row.id) ?? [],
      }),
    ),
  );
});

router.post(
  "/dms/:threadId/messages",
  messageSendRateLimit,
  async (req, res): Promise<void> => {
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

    if (!canSendDm(thread, userId)) {
      res.status(403).json({
        error:
          thread.status === "rejected"
            ? "This person has declined your message request."
            : "Waiting for the other person to accept your message request before you can reply.",
      });
      return;
    }

    const parsed = SendDmMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Same defensive check as the group version: only accept a replyToId that
    // points at a real message within this same thread.
    let replyToId: number | null = null;
    if (parsed.data.replyToId) {
      const candidate = Number.parseInt(parsed.data.replyToId, 10);
      if (Number.isFinite(candidate)) {
        const [target] = await db
          .select({ id: dmMessagesTable.id })
          .from(dmMessagesTable)
          .where(
            and(
              eq(dmMessagesTable.id, candidate),
              eq(dmMessagesTable.threadId, threadId),
            ),
          );
        if (target) replyToId = target.id;
      }
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
        durationSeconds: parsed.data.durationSeconds ?? null,
        replyToId,
      })
      .returning();

    const [sender] = await db
      .select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    const replyTo = message.replyToId
      ? ((await getDmReplyPreviewsByReplyToId([message.replyToId])).get(
          message.replyToId,
        ) ?? null)
      : null;

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
      durationSeconds: message.durationSeconds,
      replyToId: message.replyToId ? String(message.replyToId) : null,
      replyTo,
      createdAt: toIso(message.createdAt),
      editedAt: null,
      deletedAt: null,
      reactions: [],
    });

    broadcastToThread(threadId, { type: "message", message: payload });

    res.status(201).json(payload);
  },
);

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

    const reactions =
      (await getDmReactionsByMessageId([messageId])).get(messageId) ?? [];
    const replyTo = updated.replyToId
      ? ((await getDmReplyPreviewsByReplyToId([updated.replyToId])).get(
          updated.replyToId,
        ) ?? null)
      : null;

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
      durationSeconds: updated.durationSeconds,
      replyToId: updated.replyToId ? String(updated.replyToId) : null,
      replyTo,
      createdAt: toIso(updated.createdAt),
      editedAt: toIsoOrNull(updated.editedAt),
      deletedAt: toIsoOrNull(updated.deletedAt),
      reactions,
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

    const reactions =
      (await getDmReactionsByMessageId([messageId])).get(messageId) ?? [];
    const replyTo = updated.replyToId
      ? ((await getDmReplyPreviewsByReplyToId([updated.replyToId])).get(
          updated.replyToId,
        ) ?? null)
      : null;

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
      durationSeconds: updated.durationSeconds,
      replyToId: updated.replyToId ? String(updated.replyToId) : null,
      replyTo,
      createdAt: toIso(updated.createdAt),
      editedAt: toIsoOrNull(updated.editedAt),
      deletedAt: toIsoOrNull(updated.deletedAt),
      reactions,
    });

    broadcastToThread(threadId, { type: "message-updated", message: payload });

    res.json(payload);
  },
);

router.put(
  "/dms/:threadId/messages/:messageId/reactions",
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

    const [existingMessage] = await db
      .select({ id: dmMessagesTable.id })
      .from(dmMessagesTable)
      .where(
        and(
          eq(dmMessagesTable.id, messageId),
          eq(dmMessagesTable.threadId, threadId),
        ),
      );
    if (!existingMessage) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const parsed = ToggleDmMessageReactionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { emoji } = parsed.data;

    const [existingReaction] = await db
      .select({ id: dmMessageReactionsTable.id })
      .from(dmMessageReactionsTable)
      .where(
        and(
          eq(dmMessageReactionsTable.dmMessageId, messageId),
          eq(dmMessageReactionsTable.userId, userId),
          eq(dmMessageReactionsTable.emoji, emoji),
        ),
      );

    if (existingReaction) {
      await db
        .delete(dmMessageReactionsTable)
        .where(eq(dmMessageReactionsTable.id, existingReaction.id));
    } else {
      await db
        .insert(dmMessageReactionsTable)
        .values({ dmMessageId: messageId, userId, emoji });
    }

    const reactions =
      (await getDmReactionsByMessageId([messageId])).get(messageId) ?? [];

    const [full] = await db
      .select()
      .from(dmMessagesTable)
      .where(eq(dmMessagesTable.id, messageId));
    const [sender] = await db
      .select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, full.senderId));

    const replyTo = full.replyToId
      ? ((await getDmReplyPreviewsByReplyToId([full.replyToId])).get(
          full.replyToId,
        ) ?? null)
      : null;

    broadcastToThread(threadId, {
      type: "message-updated",
      message: SendDmMessageResponse.parse({
        id: String(full.id),
        threadId: String(full.threadId),
        senderId: full.senderId,
        senderName: sender?.name ?? "Family Member",
        senderAvatarUrl: sender?.avatarUrl ?? null,
        content: full.content,
        type: full.type,
        fileName: full.fileName,
        mimeType: full.mimeType,
        fileSize: full.fileSize,
        durationSeconds: full.durationSeconds,
        replyToId: full.replyToId ? String(full.replyToId) : null,
        replyTo,
        createdAt: toIso(full.createdAt),
        editedAt: toIsoOrNull(full.editedAt),
        deletedAt: toIsoOrNull(full.deletedAt),
        reactions,
      }),
    });

    res.json(ToggleDmMessageReactionResponse.parse(reactions));
  },
);

export default router;
