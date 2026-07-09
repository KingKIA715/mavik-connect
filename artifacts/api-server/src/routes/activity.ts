import { Router, type IRouter } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import {
  db,
  groupMembersTable,
  groupsTable,
  messagesTable,
  usersTable,
} from "@workspace/db";
import { GetRecentActivityResponseItem } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { toIso } from "../lib/serialize";

const router: IRouter = Router();

function parsePaginationQuery(query: Record<string, unknown>): {
  limit: number;
  offset: number;
} {
  const rawLimit = Number(query.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 100
      ? Math.floor(rawLimit)
      : 30;

  const rawOffset = Number(query.offset);
  const offset =
    Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.floor(rawOffset) : 0;

  return { limit, offset };
}

router.get("/activity", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;
  const { limit, offset } = parsePaginationQuery(req.query);

  const memberships = await db
    .select({ groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.userId, userId));
  const groupIds = memberships.map((m) => m.groupId);

  if (groupIds.length === 0) {
    res.json([]);
    return;
  }

  const rows = await db
    .select({
      groupId: messagesTable.groupId,
      groupName: groupsTable.name,
      senderId: messagesTable.senderId,
      senderName: usersTable.name,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .innerJoin(groupsTable, eq(messagesTable.groupId, groupsTable.id))
    .innerJoin(usersTable, eq(messagesTable.senderId, usersTable.id))
    .where(inArray(messagesTable.groupId, groupIds))
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(
    rows.map((row) =>
      GetRecentActivityResponseItem.parse({
        ...row,
        groupId: String(row.groupId),
        createdAt: toIso(row.createdAt),
      }),
    ),
  );
});

export default router;
