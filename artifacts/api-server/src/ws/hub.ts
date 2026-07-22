import type { WebSocket } from "ws";
import { logger } from "../lib/logger";

/**
 * In-memory WebSocket hub for a group chat / video-call app.
 *
 * Protocol (JSON messages over a single `/api/ws?groupId=<id>` connection
 * per open group, authenticated via the Clerk session cookie during the
 * HTTP upgrade):
 *
 * Server -> client:
 *   { type: "message", message: Message }            new chat message
 *   { type: "presence", userIds: string[] }           who's connected to this group right now
 *   { type: "signal", from: string, data: unknown }   forwarded WebRTC signaling payload
 *
 * Client -> server:
 *   { type: "signal", to: string, data: unknown }     WebRTC offer/answer/ice-candidate, relayed to one peer
 *   { type: "signal-broadcast", data: unknown }        relayed to all other peers in the group (e.g. call invite)
 *
 * DM threads use a separate `/api/ws?threadId=<id>` connection, authenticated
 * the same way, supporting the same message + signal protocol as groups
 * (always exactly 2 participants instead of N). No presence broadcast for
 * DMs — not needed with only one other person.
 *
 * A third connection scope, `/api/ws?scope=user`, is global to the
 * authenticated user rather than tied to one group/thread — deliberately
 * separate from the two above rather than trying to overload them, since
 * "am I looking at this specific conversation" and "is my app open at all"
 * are different questions. It exists purely to deliver events that need to
 * reach a user regardless of which page (if any conversation page at all)
 * they currently have open — today, just incoming-call ringing (see
 * routes/dmCalls.ts): the actual WebRTC media signaling above is untouched
 * and still happens over the per-thread/group connection once a call is
 * answered.
 *
 * Server -> client (user scope):
 *   { type: "incoming-call", ... }      see routes/dmCalls.ts for the full shape
 *   { type: "call-answered", callId }
 *   { type: "call-declined", callId }
 *   { type: "call-cancelled", callId }
 */

interface Connection {
  ws: WebSocket;
  userId: string;
}

const userConnections = new Map<string, Set<Connection>>();

export function registerUserConnection(
  userId: string,
  ws: WebSocket,
): Connection {
  const conn: Connection = { ws, userId };
  const set = userConnections.get(userId) ?? new Set<Connection>();
  set.add(conn);
  userConnections.set(userId, set);
  return conn;
}

export function unregisterUserConnection(
  userId: string,
  conn: Connection,
): void {
  const set = userConnections.get(userId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) userConnections.delete(userId);
}

/**
 * Whether `userId` currently has the app open at all (any tab/device),
 * regardless of which conversation — used to decide "ring live over
 * WebSocket" vs "this person isn't around, send a push notification
 * instead" for incoming calls.
 */
export function isUserOnline(userId: string): boolean {
  const set = userConnections.get(userId);
  return !!set && set.size > 0;
}

export function sendToUserGlobal(userId: string, payload: unknown): void {
  const set = userConnections.get(userId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const conn of set) {
    if (conn.ws.readyState === conn.ws.OPEN) {
      try {
        conn.ws.send(data);
      } catch (err) {
        logger.error({ err, userId }, "Failed to send WS message");
      }
    }
  }
}

const groupConnections = new Map<number, Set<Connection>>();

export function registerConnection(
  groupId: number,
  userId: string,
  ws: WebSocket,
): Connection {
  const conn: Connection = { ws, userId };
  const set = groupConnections.get(groupId) ?? new Set<Connection>();
  set.add(conn);
  groupConnections.set(groupId, set);
  broadcastPresence(groupId);
  return conn;
}

export function unregisterConnection(groupId: number, conn: Connection): void {
  const set = groupConnections.get(groupId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) {
    groupConnections.delete(groupId);
  } else {
    broadcastPresence(groupId);
  }
}

function broadcastPresence(groupId: number): void {
  const set = groupConnections.get(groupId);
  if (!set) return;
  const userIds = Array.from(new Set(Array.from(set).map((c) => c.userId)));
  broadcastToGroup(groupId, { type: "presence", userIds });
}

export function broadcastToGroup(
  groupId: number,
  payload: unknown,
  exclude?: Connection,
): void {
  const set = groupConnections.get(groupId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const conn of set) {
    if (conn === exclude) continue;
    if (conn.ws.readyState === conn.ws.OPEN) {
      try {
        conn.ws.send(data);
      } catch (err) {
        logger.error({ err, groupId }, "Failed to send WS message");
      }
    }
  }
}

export function sendToUser(
  groupId: number,
  userId: string,
  payload: unknown,
): void {
  const set = groupConnections.get(groupId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const conn of set) {
    if (conn.userId === userId && conn.ws.readyState === conn.ws.OPEN) {
      conn.ws.send(data);
    }
  }
}

/**
 * Separate in-memory registry for DM thread connections (`/api/ws?threadId=<id>`).
 * Kept independent from `groupConnections` since group and thread ids are
 * both plain numbers from separate tables and must never be conflated.
 */
const threadConnections = new Map<number, Set<Connection>>();

export function registerThreadConnection(
  threadId: number,
  userId: string,
  ws: WebSocket,
): Connection {
  const conn: Connection = { ws, userId };
  const set = threadConnections.get(threadId) ?? new Set<Connection>();
  set.add(conn);
  threadConnections.set(threadId, set);
  return conn;
}

export function unregisterThreadConnection(
  threadId: number,
  conn: Connection,
): void {
  const set = threadConnections.get(threadId);
  if (!set) return;
  set.delete(conn);
  if (set.size === 0) {
    threadConnections.delete(threadId);
  }
}

export function broadcastToThread(
  threadId: number,
  payload: unknown,
  exclude?: Connection,
): void {
  const set = threadConnections.get(threadId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const conn of set) {
    if (conn === exclude) continue;
    if (conn.ws.readyState === conn.ws.OPEN) {
      try {
        conn.ws.send(data);
      } catch (err) {
        logger.error({ err, threadId }, "Failed to send WS message");
      }
    }
  }
}

export function sendToUserInThread(
  threadId: number,
  userId: string,
  payload: unknown,
): void {
  const set = threadConnections.get(threadId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const conn of set) {
    if (conn.userId === userId && conn.ws.readyState === conn.ws.OPEN) {
      conn.ws.send(data);
    }
  }
}
