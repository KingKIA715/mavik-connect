import { Router, type IRouter } from "express";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  groupKeysTable,
  groupMembersTable,
  groupsTable,
  messagesTable,
  messageReactionsTable,
  usersTable,
} from "@workspace/db";
import {
  AddGroupMemberBody,
  AddGroupMemberResponse,
  CreateGroupBody,
  CreateGroupResponse,
  GetGroupResponse,
  GetMyGroupKeyResponse,
  ListGroupsResponseItem,
  SetGroupKeyBody,
  SetGroupKeyResponse,
  MarkGroupReadResponse,
  SetGroupPinnedBody,
  SetGroupPinnedResponse,
  SetGroupAvatarBody,
  SetGroupAvatarResponse,
  ToggleMessageReactionBody,
  ToggleMessageReactionResponse,
  SendMessageResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { keyRequestRateLimit } from "../middlewares/rateLimit";
import { parseGroupId, isGroupMember } from "../lib/groupAccess";
import { broadcastToGroup, sendToUser } from "../ws/hub";
import { toIso, toIsoOrNull } from "../lib/serialize";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/groups", async (req, res): Promise<void> => {
  const userId = req.userId!;

  const memberships = await db
    .select({ groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.userId, userId));

  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length === 0) {
    res.json([]);
    return;
  }

  const groups = await db
    .select()
    .from(groupsTable)
    .where(inArray(groupsTable.id, groupIds))
    .orderBy(desc(groupsTable.createdAt));

  const memberCounts = await db
    .select({
      groupId: groupMembersTable.groupId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(groupMembersTable)
    .where(inArray(groupMembersTable.groupId, groupIds))
    .groupBy(groupMembersTable.groupId);
  const memberCountByGroup = new Map(
    memberCounts.map((row) => [row.groupId, row.count]),
  );

  const lastMessages = await db
    .select({
      groupId: messagesTable.groupId,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .where(inArray(messagesTable.groupId, groupIds))
    .orderBy(desc(messagesTable.createdAt));
  const lastMessageByGroup = new Map<
    number,
    { content: string; createdAt: Date }
  >();
  for (const row of lastMessages) {
    if (!lastMessageByGroup.has(row.groupId)) {
      lastMessageByGroup.set(row.groupId, {
        content: row.content,
        createdAt: row.createdAt,
      });
    }
  }

  const myMemberships = await db
    .select({
      groupId: groupMembersTable.groupId,
      lastReadAt: groupMembersTable.lastReadAt,
      pinnedAt: groupMembersTable.pinnedAt,
    })
    .from(groupMembersTable)
    .where(
      and(
        inArray(groupMembersTable.groupId, groupIds),
        eq(groupMembersTable.userId, userId),
      ),
    );
  const myLastReadByGroup = new Map(
    myMemberships.map((m) => [m.groupId, m.lastReadAt]),
  );
  const myPinnedByGroup = new Map(
    myMemberships.map((m) => [m.groupId, m.pinnedAt]),
  );

  // Unread badge count per group: messages from anyone else, created after
  // my last-read timestamp for that group (never-read groups count
  // everything not sent by me).
  const unreadCounts = await Promise.all(
    groupIds.map(async (groupId) => {
      const myLastReadAt = myLastReadByGroup.get(groupId) ?? null;
      const rows = await db
        .select({ id: messagesTable.id })
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.groupId, groupId),
            ne(messagesTable.senderId, userId),
            myLastReadAt
              ? gt(messagesTable.createdAt, myLastReadAt)
              : undefined,
          ),
        );
      return { groupId, count: rows.length };
    }),
  );
  const unreadCountByGroup = new Map(
    unreadCounts.map((u) => [u.groupId, u.count]),
  );

  const result = groups.map((group) => {
    const lastMessage = lastMessageByGroup.get(group.id);
    return {
      id: String(group.id),
      name: group.name,
      createdBy: group.createdBy,
      createdAt: toIso(group.createdAt),
      avatarUrl: group.avatarUrl,
      memberCount: memberCountByGroup.get(group.id) ?? 0,
      lastMessageAt: toIsoOrNull(lastMessage?.createdAt),
      lastMessagePreview: lastMessage?.content ?? null,
      myLastReadAt: toIsoOrNull(myLastReadByGroup.get(group.id)),
      unreadCount: unreadCountByGroup.get(group.id) ?? 0,
      isPinned: !!myPinnedByGroup.get(group.id),
    };
  });

  res.json(result.map((g) => ListGroupsResponseItem.parse(g)));
});

router.post("/groups", async (req, res): Promise<void> => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;

  const group = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(groupsTable)
      .values({ name: parsed.data.name, createdBy: userId })
      .returning();
    await tx.insert(groupMembersTable).values({
      groupId: created.id,
      userId,
      role: "owner",
    });
    return created;
  });

  res.status(201).json(
    CreateGroupResponse.parse({
      id: String(group.id),
      name: group.name,
      createdBy: group.createdBy,
      createdAt: toIso(group.createdAt),
      avatarUrl: null,
      memberCount: 1,
      lastMessageAt: null,
      lastMessagePreview: null,
      myLastReadAt: null,
      unreadCount: 0,
      isPinned: false,
    }),
  );
});

router.get("/groups/:groupId", async (req, res): Promise<void> => {
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

  const [group] = await db
    .select()
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId));
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const members = await db
    .select({
      userId: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      avatarUrl: usersTable.avatarUrl,
      publicKey: usersTable.publicKey,
      role: groupMembersTable.role,
      joinedAt: groupMembersTable.joinedAt,
      lastReadAt: groupMembersTable.lastReadAt,
    })
    .from(groupMembersTable)
    .innerJoin(usersTable, eq(groupMembersTable.userId, usersTable.id))
    .where(eq(groupMembersTable.groupId, groupId));

  const keyHolders = await db
    .select({ userId: groupKeysTable.userId })
    .from(groupKeysTable)
    .where(eq(groupKeysTable.groupId, groupId));
  const keyHolderSet = new Set(keyHolders.map((k) => k.userId));

  res.json(
    GetGroupResponse.parse({
      id: String(group.id),
      name: group.name,
      createdBy: group.createdBy,
      createdAt: toIso(group.createdAt),
      avatarUrl: group.avatarUrl,
      members: members.map((m) => ({
        ...m,
        joinedAt: toIso(m.joinedAt),
        lastReadAt: toIsoOrNull(m.lastReadAt),
        hasEncryptionKey: keyHolderSet.has(m.userId),
      })),
    }),
  );
});

router.put("/groups/:groupId/avatar", async (req, res): Promise<void> => {
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

  const parsed = SetGroupAvatarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { avatarUrl } = parsed.data;
  if (avatarUrl !== null) {
    // Basic sanity checks — this isn't going through the message-encryption
    // path, so keep it small and image-only. The client resizes to a
    // thumbnail before uploading; this is a backstop, not the primary
    // control.
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(avatarUrl)) {
      res.status(400).json({ error: "Must be an image data URI" });
      return;
    }
    const MAX_LENGTH = 400_000; // ~300KB of image data, base64-inflated
    if (avatarUrl.length > MAX_LENGTH) {
      res.status(400).json({ error: "Image is too large" });
      return;
    }
  }

  await db
    .update(groupsTable)
    .set({ avatarUrl })
    .where(eq(groupsTable.id, groupId));

  res.json(SetGroupAvatarResponse.parse({ avatarUrl }));
});

router.delete("/groups/:groupId", async (req, res): Promise<void> => {
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

  const [group] = await db
    .select({ createdBy: groupsTable.createdBy })
    .from(groupsTable)
    .where(eq(groupsTable.id, groupId));
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  if (group.createdBy !== userId) {
    res.status(403).json({ error: "Only the group's creator can delete it" });
    return;
  }

  // Notify anyone currently connected before the row (and its cascading
  // members/messages/keys) disappears out from under them.
  broadcastToGroup(groupId, {
    type: "group-deleted",
    groupId: String(groupId),
  });

  await db.delete(groupsTable).where(eq(groupsTable.id, groupId));

  res.sendStatus(204);
});

router.post("/groups/:groupId/members", async (req, res): Promise<void> => {
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

  const parsed = AddGroupMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [invitee] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, parsed.data.email));
  if (!invitee) {
    res.status(404).json({ error: "User with that email not found" });
    return;
  }

  await db
    .insert(groupMembersTable)
    .values({ groupId, userId: invitee.id, role: "member" })
    .onConflictDoNothing();

  const [membership] = await db
    .select({
      joinedAt: groupMembersTable.joinedAt,
      role: groupMembersTable.role,
    })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.userId, invitee.id),
      ),
    );

  res.status(201).json(
    AddGroupMemberResponse.parse({
      userId: invitee.id,
      name: invitee.name,
      email: invitee.email,
      avatarUrl: invitee.avatarUrl,
      publicKey: invitee.publicKey,
      hasEncryptionKey: false,
      role: membership?.role ?? "member",
      joinedAt: toIso(membership?.joinedAt ?? new Date()),
      lastReadAt: null,
    }),
  );
});

router.get("/groups/:groupId/key", async (req, res): Promise<void> => {
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

  const [key] = await db
    .select({ wrappedKey: groupKeysTable.wrappedKey })
    .from(groupKeysTable)
    .where(
      and(
        eq(groupKeysTable.groupId, groupId),
        eq(groupKeysTable.userId, userId),
      ),
    );

  res.json(
    GetMyGroupKeyResponse.parse({
      groupId: String(groupId),
      wrappedKey: key?.wrappedKey ?? null,
    }),
  );
});

router.put("/groups/:groupId/read", async (req, res): Promise<void> => {
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

  const now = new Date();
  await db
    .update(groupMembersTable)
    .set({ lastReadAt: now })
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.userId, userId),
      ),
    );

  // Let anyone currently viewing the group know live, so their "Seen"
  // receipt updates without a reload.
  broadcastToGroup(groupId, { type: "read", userId, lastReadAt: toIso(now) });

  res.json(MarkGroupReadResponse.parse({ lastReadAt: toIso(now) }));
});

router.put("/groups/:groupId/pin", async (req, res): Promise<void> => {
  const groupId = parseGroupId(req.params.groupId);
  if (groupId === null) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const parsed = SetGroupPinnedBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;
  const member = await isGroupMember(groupId, userId);
  if (!member) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  // Purely personal — only ever touches the caller's own membership row,
  // never broadcast to anyone else.
  await db
    .update(groupMembersTable)
    .set({ pinnedAt: parsed.data.pinned ? new Date() : null })
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.userId, userId),
      ),
    );

  res.json(SetGroupPinnedResponse.parse({ isPinned: parsed.data.pinned }));
});

router.post("/groups/:groupId/keys", async (req, res): Promise<void> => {
  const groupId = parseGroupId(req.params.groupId);
  if (groupId === null) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const requesterId = req.userId!;
  const requesterIsMember = await isGroupMember(groupId, requesterId);
  if (!requesterIsMember) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const parsed = SetGroupKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const targetIsMember = await isGroupMember(groupId, parsed.data.userId);
  if (!targetIsMember) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  await db
    .insert(groupKeysTable)
    .values({
      groupId,
      userId: parsed.data.userId,
      wrappedKey: parsed.data.wrappedKey,
    })
    .onConflictDoUpdate({
      target: [groupKeysTable.groupId, groupKeysTable.userId],
      set: { wrappedKey: parsed.data.wrappedKey },
    });

  // Tell the recipient's client (if connected to this group) that a key is
  // now available, so it can refetch instead of staying stuck on "missing"
  // until they happen to reload the page.
  sendToUser(groupId, parsed.data.userId, { type: "group-key-ready" });

  res.status(201).json(
    SetGroupKeyResponse.parse({
      groupId: String(groupId),
      wrappedKey: parsed.data.wrappedKey,
    }),
  );
});

router.post(
  "/groups/:groupId/keys/request",
  keyRequestRateLimit,
  async (req, res): Promise<void> => {
    const groupId = parseGroupId(req.params.groupId);
    if (groupId === null) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const requesterId = req.userId!;
    const requesterIsMember = await isGroupMember(groupId, requesterId);
    if (!requesterIsMember) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    // Best-effort nudge: anyone else currently connected to this group who
    // already holds the decrypted key will re-share it for requesterId. If
    // no one else is online right now, this is a no-op — the existing
    // "share on reconnect" flow is still the fallback.
    broadcastToGroup(groupId, { type: "group-key-requested", requesterId });

    res.status(202).end();
  },
);

router.delete(
  "/groups/:groupId/members/:userId",
  async (req, res): Promise<void> => {
    const groupId = parseGroupId(req.params.groupId);
    const targetUserId = Array.isArray(req.params.userId)
      ? req.params.userId[0]
      : req.params.userId;
    if (groupId === null || !targetUserId) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    const requesterId = req.userId!;
    const requesterIsMember = await isGroupMember(groupId, requesterId);
    if (!requesterIsMember) {
      res.status(404).json({ error: "Group not found" });
      return;
    }

    // Anyone can remove themselves (leave). Removing someone else requires
    // being the group's creator — previously any member could remove any
    // other member, which was an access-control gap.
    if (targetUserId !== requesterId) {
      const [group] = await db
        .select({ createdBy: groupsTable.createdBy })
        .from(groupsTable)
        .where(eq(groupsTable.id, groupId));
      if (!group) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      if (group.createdBy !== requesterId) {
        res.status(403).json({
          error: "Only the group's creator can remove other members",
        });
        return;
      }
    }

    // Look up the departing member's name before removing their membership
    // row (the user row itself isn't touched, but fetching it first keeps
    // this independent of that ordering).
    const [targetUser] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId));
    const targetName = targetUser?.name ?? "A member";
    const wasSelfInitiated = targetUserId === requesterId;

    await db
      .delete(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.groupId, groupId),
          eq(groupMembersTable.userId, targetUserId),
        ),
      );

    // Announce the departure in the group's own chat history as a "system"
    // message — same wording rule for both self-leave and creator-removal,
    // since the spec calls for a record "if anyone leaves". This is
    // server-generated plain text (not E2E-encrypted) — see the schema
    // comment on messagesTable.type for why that's an acceptable exception
    // here. senderId is the departing member themselves (still a valid user
    // row even though their membership is now gone), which both satisfies
    // the NOT NULL/FK constraint and reads naturally as "who this message
    // is about".
    const systemContent = wasSelfInitiated
      ? `${targetName} left the group.`
      : `${targetName} was removed from the group.`;

    const [systemMessage] = await db
      .insert(messagesTable)
      .values({
        groupId,
        senderId: targetUserId,
        content: systemContent,
        type: "system",
      })
      .returning();

    const systemPayload = SendMessageResponse.parse({
      id: String(systemMessage.id),
      groupId: String(systemMessage.groupId),
      senderId: systemMessage.senderId,
      senderName: targetName,
      senderAvatarUrl: null,
      content: systemMessage.content,
      type: systemMessage.type,
      fileName: null,
      mimeType: null,
      fileSize: null,
      durationSeconds: null,
      replyToId: null,
      replyTo: null,
      mentionedUserIds: systemMessage.mentionedUserIds,
      createdAt: toIso(systemMessage.createdAt),
      editedAt: null,
      deletedAt: null,
      reactions: [],
    });

    // Let anyone still connected know live: other members should drop this
    // person from their member list, and the removed person themselves (if
    // it wasn't a self-initiated leave) should be kicked out of the chat.
    broadcastToGroup(groupId, { type: "member-removed", userId: targetUserId });
    // Broadcast the system message the same way a normal new message is
    // broadcast, so it appears live in the chat for everyone still there.
    broadcastToGroup(groupId, { type: "message", message: systemPayload });

    res.sendStatus(204);
  },
);

export default router;
