import { and, eq } from "drizzle-orm";
import { db, dmThreadsTable } from "@workspace/db";

/**
 * Parses a threadId route param (always a numeric string in this app) into
 * an integer, or returns null if it isn't a valid positive integer.
 */
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
    .select({
      userAId: dmThreadsTable.userAId,
      userBId: dmThreadsTable.userBId,
    })
    .from(dmThreadsTable)
    .where(eq(dmThreadsTable.id, threadId));

  if (!thread) return false;
  return thread.userAId === userId || thread.userBId === userId;
}

export async function getOtherParticipant(
  threadId: number,
  userId: string,
): Promise<string | null> {
  const [thread] = await db
    .select({
      userAId: dmThreadsTable.userAId,
      userBId: dmThreadsTable.userBId,
    })
    .from(dmThreadsTable)
    .where(eq(dmThreadsTable.id, threadId));

  if (!thread) return null;
  if (thread.userAId === userId) return thread.userBId;
  if (thread.userBId === userId) return thread.userAId;
  return null;
}

/**
 * A DM thread stores one last-read timestamp per side (userA/userB) rather
 * than a per-user join table, since a thread only ever has exactly 2
 * participants (see dm_threads schema). This picks out "mine" vs "theirs"
 * for whichever side `userId` is on.
 */
export function getReadTimestamps(
  thread: {
    userAId: string;
    userBId: string;
    userALastReadAt: Date | null;
    userBLastReadAt: Date | null;
  },
  userId: string,
): { myLastReadAt: Date | null; otherLastReadAt: Date | null } {
  const isUserA = thread.userAId === userId;
  return {
    myLastReadAt: isUserA ? thread.userALastReadAt : thread.userBLastReadAt,
    otherLastReadAt: isUserA ? thread.userBLastReadAt : thread.userALastReadAt,
  };
}

/** Which dm_threads column to update when `userId` marks a thread read. */
export function myLastReadColumn(
  thread: { userAId: string; userBId: string },
  userId: string,
): "userALastReadAt" | "userBLastReadAt" {
  return thread.userAId === userId ? "userALastReadAt" : "userBLastReadAt";
}

/**
 * Finds the existing DM thread between two users, or creates one. Threads
 * are stored with userAId/userBId in canonical (sorted) order so each pair
 * of users maps to exactly one thread, regardless of who initiates.
 */
export async function findOrCreateThread(userId: string, otherUserId: string) {
  const [userAId, userBId] = [userId, otherUserId].sort();

  const [existing] = await db
    .select()
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
    .onConflictDoNothing({
      target: [dmThreadsTable.userAId, dmThreadsTable.userBId],
    })
    .returning();
  if (created) return created;

  // Another request created the thread concurrently between our SELECT and
  // INSERT (onConflictDoNothing means our insert silently no-op'd) — re-read it.
  const [thread] = await db
    .select()
    .from(dmThreadsTable)
    .where(
      and(
        eq(dmThreadsTable.userAId, userAId),
        eq(dmThreadsTable.userBId, userBId),
      ),
    );
  if (!thread) {
    throw new Error("Failed to find or create DM thread");
  }
  return thread;
}
