import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
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
  ListGroupsResponseItem,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { parseGroupId, isGroupMember } from "../lib/groupAccess";
import { broadcastToGroup } from "../ws/hub";

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

  const result = groups.map((group) => {
    const lastMessage = lastMessageByGroup.get(group.id);
    return {
      id: String(group.id),
      name: group.name,
      createdBy: group.createdBy,
      createdAt: group.createdAt,
      memberCount: memberCountByGroup.get(group.id) ?? 0,
      lastMessageAt: lastMessage?.createdAt ?? null,
      lastMessagePreview: lastMessage?.content ?? null,
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
      createdAt: group.createdAt,
      memberCount: 1,
      lastMessageAt: null,
      lastMessagePreview: null,
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
      role: groupMembersTable.role,
      joinedAt: groupMembersTable.joinedAt,
    })
    .from(groupMembersTable)
    .innerJoin(usersTable, eq(groupMembersTable.userId, usersTable.id))
    .where(eq(groupMembersTable.groupId, groupId));

  res.json(
    GetGroupResponse.parse({
      id: String(group.id),
      name: group.name,
      createdBy: group.createdBy,
      createdAt: group.createdAt,
      members,
    }),
  );
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
      role: membership?.role ?? "member",
      joinedAt: membership?.joinedAt ?? new Date(),
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

    await db
      .delete(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.groupId, groupId),
          eq(groupMembersTable.userId, targetUserId),
        ),
      );

    res.sendStatus(204);
  },
);

export default router;
