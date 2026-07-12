import { and, eq, or } from "drizzle-orm";
import { db, dmThreadsTable } from "@workspace/db";

export function parseThreadId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function isThreadParticipant(
  threadId: number,
  userId: string,
): Promise<boolean> {
  const [thread] = await db
    .select({ id: dmThreadsTable.id })
    .from(dmThreadsTable)
    .where(
      and(
        eq(dmThreadsTable.id, threadId),
        or(
          eq(dmThreadsTable.userAId, userId),
          eq(dmThreadsTable.userBId, userId),
        ),
      ),
    );
  return Boolean(thread);
}

/** Returns the id of the other person in a thread the given user belongs to, or null. */
export async function getOtherParticipant(
  threadId: number,
  userId: string,
): Promise<string | null> {
  const [thread] = await db
    .select({ userAId: dmThreadsTable.userAId, userBId: dmThreadsTable.userBId })
    .from(dmThreadsTable)
    .where(eq(dmThreadsTable.id, threadId));
  if (!thread) return null;
  if (thread.userAId === userId) return thread.userBId;
  if (thread.userBId === userId) return thread.userAId;
  return null;
}

/**
 * Finds the existing thread between two users, or creates one. Ids are
 * stored in a canonical (sorted) order so there is exactly one thread per
 * pair of users no matter who starts the conversation.
 */
export async function findOrCreateThread(
  userId: string,
  otherUserId: string,
): Promise<{ id: number; createdAt: Date }> {
  const [userAId, userBId] =
    userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];

  const [existing] = await db
    .select({ id: dmThreadsTable.id, createdAt: dmThreadsTable.createdAt })
    .from(dmThreadsTable)
    .where(
      and(
        eq(dmThreadsTable.userAId, userAId),
        eq(dmThreadsTable.userBId, userBId),
      ),
    );
  if (existing) return existing;

  const [created] = await db
    .insert(dmThreadsTable)
    .values({ userAId, userBId })
    .onConflictDoNothing()
    .returning({ id: dmThreadsTable.id, createdAt: dmThreadsTable.createdAt });

  if (created) return created;

  // Lost a race with a concurrent request creating the same thread — fetch it.
  const [row] = await db
    .select({ id: dmThreadsTable.id, createdAt: dmThreadsTable.createdAt })
    .from(dmThreadsTable)
    .where(
      and(
        eq(dmThreadsTable.userAId, userAId),
        eq(dmThreadsTable.userBId, userBId),
      ),
    );
  return row;
}
