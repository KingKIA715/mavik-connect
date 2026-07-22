import { and, eq, isNull } from "drizzle-orm";
import { db, groupCallsTable, messagesTable, usersTable } from "@workspace/db";
import { SendMessageResponse } from "@workspace/api-zod";
import { broadcastToGroup } from "../ws/hub";
import { toIso } from "./serialize";

/**
 * In-memory active-participant tracking per group call, driven by explicit
 * join/leave REST calls from the call screen's mount/unmount lifecycle —
 * NOT inferred from generic WebSocket connection presence. (The call page
 * and the regular chat page both open the same kind of per-group WS
 * connection, so "connected to this group's socket" can't reliably tell
 * you "on the call screen" vs "just chatting" — see ws/hub.ts.) Consistent
 * with the rest of this app's in-memory-only approach to live call state.
 */
const activeParticipants = new Map<number, Set<string>>();

/**
 * Joins (creating if necessary) the group's currently-active call. Returns
 * the callId either way — safe to call repeatedly/idempotently as
 * multiple members join the same session.
 */
export async function joinGroupCall(
  groupId: number,
  userId: string,
  kind: "audio" | "video",
): Promise<number> {
  const [existing] = await db
    .select()
    .from(groupCallsTable)
    .where(
      and(
        eq(groupCallsTable.groupId, groupId),
        isNull(groupCallsTable.endedAt),
      ),
    );

  let callId: number;
  if (existing) {
    callId = existing.id;
  } else {
    const [call] = await db
      .insert(groupCallsTable)
      .values({ groupId, callerId: userId, kind })
      .returning();
    callId = call.id;
  }

  const set = activeParticipants.get(callId) ?? new Set<string>();
  set.add(userId);
  activeParticipants.set(callId, set);

  return callId;
}

/**
 * Leaves a group call. If this was the last tracked participant, finalizes
 * it — writes a compact, unencrypted duration summary into the group's
 * messages (same deliberate exception to E2E already used for "system"
 * messages) and broadcasts it exactly like a normal new message.
 */
export async function leaveGroupCall(
  groupId: number,
  callId: number,
  userId: string,
): Promise<void> {
  const set = activeParticipants.get(callId);
  set?.delete(userId);

  // Treat "no set at all" (e.g. a server restart lost the in-memory
  // tracking) the same as "empty" — better to finalize a call a little
  // early/late than to leave it stuck "active" forever.
  if (set && set.size > 0) return;
  activeParticipants.delete(callId);

  const [call] = await db
    .select()
    .from(groupCallsTable)
    .where(eq(groupCallsTable.id, callId));
  if (!call || call.groupId !== groupId || call.logMessageId !== null) return;
  if (call.endedAt !== null) return;

  const now = new Date();
  const durationSeconds = Math.max(
    0,
    Math.round((now.getTime() - call.startedAt.getTime()) / 1000),
  );

  const content = JSON.stringify({
    kind: call.kind,
    status: "ended",
    durationSeconds,
  });

  const [message] = await db
    .insert(messagesTable)
    .values({
      groupId: call.groupId,
      senderId: call.callerId,
      content,
      type: "call",
    })
    .returning();

  await db
    .update(groupCallsTable)
    .set({ endedAt: now, logMessageId: message.id })
    .where(eq(groupCallsTable.id, callId));

  const [sender] = await db
    .select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, call.callerId));

  const payload = SendMessageResponse.parse({
    id: String(message.id),
    groupId: String(message.groupId),
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
    mentionedUserIds: [],
    createdAt: toIso(message.createdAt),
    editedAt: null,
    deletedAt: null,
    reactions: [],
  });

  broadcastToGroup(call.groupId, { type: "message", message: payload });
}
