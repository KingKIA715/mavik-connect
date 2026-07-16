import { Router, type IRouter } from "express";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  groupKeysTable,
  groupMembersTable,
  groupsTable,
  messagesTable,
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
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
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
            myLastReadAt ? gt(messagesTable.createdAt, myLastReadAt) : undefined,
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
      memberCount: memberCountByGroup.get(group.id) ?? 0,
      lastMessageAt: toIsoOrNull(lastMessage?.createdAt),
      lastMessagePreview: lastMessage?.content ?? null,
      myLastReadAt: toIsoOrNull(myLastReadByGroup.get(group.id)),
      unreadCount: unreadCountByGroup.get(group.id) ?? 0,
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
      memberCount: 1,
      lastMessageAt: null,
      lastMessagePreview: null,
      myLastReadAt: null,
      unreadCount: 0,
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
      members: members.map((m) => ({
        ...m,
        joinedAt: toIso(m.joinedAt),
        lastReadAt: toIsoOrNull(m.lastReadAt),
        hasEncryptionKey: keyHolderSet.has(m.userId),
      })),
    }),
  );
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
  broadcastToGroup(groupId, { type: "group-deleted", groupId: String(groupId) });

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
    .select({ joinedAt: groupMembersTable.joinedAt, role: groupMembersTable.role })
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

    await db
      .delete(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.groupId, groupId),
          eq(groupMembersTable.userId, targetUserId),
        ),
      );

    // Let anyone still connected know live: other members should drop this
    // person from their member list, and the removed person themselves (if
    // it wasn't a self-initiated leave) should be kicked out of the chat.
    broadcastToGroup(groupId, { type: "member-removed", userId: targetUserId });

    res.sendStatus(204);
  },
);

export default router;
