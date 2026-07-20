import { and, count, eq } from "drizzle-orm";
import { db, dmThreadsTable } from "@workspace/db";

/**
 * Parses a threadId route param (always a numeric string in this app) into
 * an integer, or returns null if it isn't a valid positive integer.
 */
export function parseThreadId(
  raw: string | string[] | undefined,
): number | null {
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

/** Which dm_threads column to update when `userId` pins/unpins a thread. */
export function myPinnedColumn(
  thread: { userAId: string; userBId: string },
  userId: string,
): "userAPinnedAt" | "userBPinnedAt" {
  return thread.userAId === userId ? "userAPinnedAt" : "userBPinnedAt";
}

/** "Mine" pinned-at timestamp, same left/right picking as getReadTimestamps. */
export function myPinnedAt(
  thread: {
    userAId: string;
    userBId: string;
    userAPinnedAt: Date | null;
    userBPinnedAt: Date | null;
  },
  userId: string,
): Date | null {
  return thread.userAId === userId
    ? thread.userAPinnedAt
    : thread.userBPinnedAt;
}

/**
 * Caps how many *new* message requests (threads this user has initiated
 * that are still sitting "pending", unanswered) one user can have open at
 * once. Guards against someone cold-messaging a large number of strangers
 * to spam them — it does NOT limit messages within an existing
 * conversation (see messageSendRateLimit for that), and it never blocks
 * re-fetching/reopening a thread that already exists for a given pair.
 */
export const MAX_PENDING_OUTBOUND_REQUESTS = 25;

/** Whether a dm_threads row already exists for this (unordered) pair. */
export async function threadExistsBetween(
  userId: string,
  otherUserId: string,
): Promise<boolean> {
  const [userAId, userBId] = [userId, otherUserId].sort();
  const [existing] = await db
    .select({ id: dmThreadsTable.id })
    .from(dmThreadsTable)
    .where(
      and(
        eq(dmThreadsTable.userAId, userAId),
        eq(dmThreadsTable.userBId, userBId),
      ),
    );
  return !!existing;
}

/** How many threads `userId` has initiated that are still status "pending". */
export async function countPendingOutboundRequests(
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(dmThreadsTable)
    .where(
      and(
        eq(dmThreadsTable.initiatorId, userId),
        eq(dmThreadsTable.status, "pending"),
      ),
    );
  return row?.count ?? 0;
}

/** Which dm_threads column to update when `userId` mutes/unmutes a thread. */
export function myMutedColumn(
  thread: { userAId: string; userBId: string },
  userId: string,
): "userAMutedAt" | "userBMutedAt" {
  return thread.userAId === userId ? "userAMutedAt" : "userBMutedAt";
}

/** "Mine" muted-at timestamp, same left/right picking as getReadTimestamps. */
export function myMutedAt(
  thread: {
    userAId: string;
    userBId: string;
    userAMutedAt: Date | null;
    userBMutedAt: Date | null;
  },
  userId: string,
): Date | null {
  return thread.userAId === userId ? thread.userAMutedAt : thread.userBMutedAt;
}

/**
 * Finds the existing DM thread between two users, or creates one. Threads
 * are stored with userAId/userBId in canonical (sorted) order so each pair
 * of users maps to exactly one thread, regardless of who initiates.
 *
 * Brand-new threads start life as a "message request": status "pending",
 * with `userId` (whoever is calling this to start the conversation)
 * recorded as initiatorId. If a thread already exists for this pair, it's
 * returned as-is — creating/re-fetching a thread never changes its status.
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
    .values({ userAId, userBId, initiatorId: userId, status: "pending" })
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

/**
 * Message-request permission check for sending into a DM thread.
 *
 * - "pending": only the initiator may send (they can send several messages
 *   before the other side responds) — the recipient must accept or reject
 *   before replying.
 * - "accepted": both sides can send freely.
 * - "rejected": a one-directional permanent block on the initiator only.
 *   The non-initiator can still send (e.g. if they change their mind later
 *   and reach out themselves) — the block never applies to them.
 */
export function canSendDm(
  thread: { initiatorId: string | null; status: string },
  senderId: string,
): boolean {
  const isInitiator =
    thread.initiatorId !== null && senderId === thread.initiatorId;
  if (thread.status === "rejected" && isInitiator) return false;
  if (thread.status === "pending" && !isInitiator) return false;
  return true;
}
