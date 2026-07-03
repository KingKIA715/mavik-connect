import { and, eq } from "drizzle-orm";
import { db, groupMembersTable } from "@workspace/db";

/**
 * Parses a groupId route param (always a numeric string in this app) into
 * an integer, or returns null if it isn't a valid positive integer.
 */
export function parseGroupId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function isGroupMember(
  groupId: number,
  userId: string,
): Promise<boolean> {
  const [membership] = await db
    .select({ userId: groupMembersTable.userId })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.userId, userId),
      ),
    );
  return Boolean(membership);
}
