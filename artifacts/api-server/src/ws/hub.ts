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
 */

interface Connection {
  ws: WebSocket;
  userId: string;
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
