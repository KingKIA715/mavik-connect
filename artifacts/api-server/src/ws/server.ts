import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer } from "ws";
import { clerkClient } from "@clerk/express";
import { db, groupMembersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { parseGroupId } from "../lib/groupAccess";
import { registerConnection, unregisterConnection, broadcastToGroup, sendToUser } from "./hub";

export const WS_PATH = "/api/ws";

function buildFetchRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? "localhost";
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
  const url = new URL(req.url ?? "/", `${proto}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  return new Request(url, { headers });
}

async function authenticateUpgrade(
  req: IncomingMessage,
): Promise<string | null> {
  try {
    const request = buildFetchRequest(req);
    const state = await clerkClient.authenticateRequest(request);
    const auth = state.toAuth();
    return auth?.userId ?? null;
  } catch (err) {
    logger.error({ err }, "WS auth failed");
    return null;
  }
}

export function attachWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== WS_PATH) return;

    void (async () => {
      const userId = await authenticateUpgrade(req);
      const groupId = parseGroupId(url.searchParams.get("groupId") ?? undefined);

      if (!userId || groupId === null) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const [membership] = await db
        .select({ userId: groupMembersTable.userId })
        .from(groupMembersTable)
        .where(
          and(
            eq(groupMembersTable.groupId, groupId),
            eq(groupMembersTable.userId, userId),
          ),
        );

      if (!membership) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn = registerConnection(groupId, userId, ws);

        ws.on("message", (raw) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            return;
          }
          if (typeof parsed !== "object" || parsed === null) return;
          const data = parsed as Record<string, unknown>;

          if (data.type === "signal" && typeof data.to === "string") {
            sendToUser(groupId, data.to, {
              type: "signal",
              from: userId,
              data: data.data,
            });
          } else if (data.type === "signal-broadcast") {
            broadcastToGroup(
              groupId,
              { type: "signal", from: userId, data: data.data },
              conn,
            );
          }
        });

        ws.on("close", () => {
          unregisterConnection(groupId, conn);
        });

        ws.on("error", (err) => {
          logger.error({ err, groupId, userId }, "WS connection error");
        });
      });
    })();
  });
}
