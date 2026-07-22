import { eq } from "drizzle-orm";
import { db, dmCallsTable, dmMessagesTable, usersTable } from "@workspace/db";
import { SendDmMessageResponse } from "@workspace/api-zod";
import { broadcastToThread } from "../ws/hub";
import { toIso } from "./serialize";

/** How long an unanswered call rings before it's finalized as "missed". */
export const CALL_RING_TIMEOUT_MS = 45_000;

/**
 * In-memory timers for currently-ringing calls, so an unanswered call gets
 * finalized automatically. Consistent with the rest of this app's
 * in-memory-only approach to live call state (see ws/hub.ts's connection
 * registries) — a server restart mid-ring would already drop the actual
 * WebRTC signaling too, so this isn't a new source of inconsistency, and it
 * avoids adding a job-scheduling system for what's a short-lived timer.
 */
const ringTimeouts = new Map<number, NodeJS.Timeout>();

export function scheduleRingTimeout(callId: number): void {
  const timeout = setTimeout(() => {
    ringTimeouts.delete(callId);
    void finalizeDmCall(callId, "missed");
  }, CALL_RING_TIMEOUT_MS);
  ringTimeouts.set(callId, timeout);
}

export function clearRingTimeout(callId: number): void {
  const timeout = ringTimeouts.get(callId);
  if (timeout) {
    clearTimeout(timeout);
    ringTimeouts.delete(callId);
  }
}

/**
 * Moves a call to a terminal state and writes a compact, unencrypted
 * summary into the thread's message stream — the same deliberate, narrow
 * exception to "server never sees plaintext" already made for groups'
 * "system" messages (see messages.ts), since this is call metadata
 * (kind/outcome/duration), not user-authored content. Broadcasts it exactly
 * like a normal new message, so it shows up live for both participants
 * with zero new client-side delivery plumbing.
 *
 * Idempotent: a call whose logMessageId is already set (or that's already
 * left the "ringing"/"answered" states) is left alone, so a race between
 * e.g. the ring timeout and a client's own "declined" request can't
 * double-log the same call.
 */
export async function finalizeDmCall(
  callId: number,
  status: "missed" | "declined" | "cancelled" | "ended",
): Promise<void> {
  clearRingTimeout(callId);

  const [call] = await db
    .select()
    .from(dmCallsTable)
    .where(eq(dmCallsTable.id, callId));
  if (!call || call.logMessageId !== null) return;
  if (call.status !== "ringing" && call.status !== "answered") return;

  const now = new Date();
  const durationSeconds =
    status === "ended" && call.answeredAt
      ? Math.max(
          0,
          Math.round((now.getTime() - call.answeredAt.getTime()) / 1000),
        )
      : null;

  const content = JSON.stringify({
    kind: call.kind,
    status,
    ...(durationSeconds !== null ? { durationSeconds } : {}),
  });

  const [message] = await db
    .insert(dmMessagesTable)
    .values({
      threadId: call.threadId,
      senderId: call.callerId,
      content,
      type: "call",
    })
    .returning();

  await db
    .update(dmCallsTable)
    .set({ status, endedAt: now, logMessageId: message.id })
    .where(eq(dmCallsTable.id, callId));

  const [sender] = await db
    .select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, call.callerId));

  const payload = SendDmMessageResponse.parse({
    id: String(message.id),
    threadId: String(message.threadId),
    senderId: message.senderId,
    senderName: sender?.name ?? "Family Member",
    senderAvatarUrl: sender?.avatarUrl ?? null,
    content: message.content,
    type: message.type,
    fileName: null,
    mimeType: null,
    fileSize: null,
    durationSeconds: null,
    replyToId: null,
    replyTo: null,
    createdAt: toIso(message.createdAt),
    editedAt: null,
    deletedAt: null,
    reactions: [],
  });

  broadcastToThread(call.threadId, { type: "message", message: payload });
}
