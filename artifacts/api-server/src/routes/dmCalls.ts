import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, dmCallsTable, dmThreadsTable, usersTable } from "@workspace/db";
import { StartDmCallBody, StartDmCallResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
// parseThreadId is a generic positive-integer path-param parser despite its
// name (see dmAccess.ts) — reused here for callId too, rather than
// duplicating it.
import { parseThreadId, canSendDm } from "../lib/dmAccess";
import { sendToUserGlobal, isUserOnline } from "../ws/hub";
import { sendPushToUser } from "../lib/push";
import {
  finalizeDmCall,
  scheduleRingTimeout,
  clearRingTimeout,
} from "../lib/dmCalls";

const router: IRouter = Router();

router.use(requireAuth);

function otherParticipant(
  thread: { userAId: string; userBId: string },
  userId: string,
): string {
  return thread.userAId === userId ? thread.userBId : thread.userAId;
}

router.post("/dms/:threadId/calls", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.threadId);
  if (threadId === null) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  const parsed = StartDmCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;
  const [thread] = await db
    .select()
    .from(dmThreadsTable)
    .where(eq(dmThreadsTable.id, threadId));
  if (!thread || (thread.userAId !== userId && thread.userBId !== userId)) {
    res.status(404).json({ error: "Thread not found" });
    return;
  }

  if (!canSendDm(thread, userId)) {
    res.status(403).json({ error: "You can't call this person right now." });
    return;
  }

  const otherUserId = otherParticipant(thread, userId);

  const [call] = await db
    .insert(dmCallsTable)
    .values({
      threadId,
      callerId: userId,
      kind: parsed.data.kind,
      status: "ringing",
    })
    .returning();

  const [caller] = await db
    .select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  sendToUserGlobal(otherUserId, {
    type: "incoming-call",
    callId: String(call.id),
    threadId: String(threadId),
    kind: call.kind,
    fromUserId: userId,
    fromName: caller?.name ?? "Family Member",
    fromAvatarUrl: caller?.avatarUrl ?? null,
  });

  // If they're online, the WS ring above already reached them — a push on
  // top would just be a redundant/confusing extra notification for
  // something already ringing on screen.
  if (!isUserOnline(otherUserId)) {
    void sendPushToUser(otherUserId, {
      title: caller?.name ?? "Family Member",
      body: `Incoming ${call.kind === "video" ? "video" : "voice"} call`,
      url: `/app/dms/${threadId}`,
    });
  }

  scheduleRingTimeout(call.id);

  res.status(201).json(
    StartDmCallResponse.parse({
      callId: String(call.id),
      calleeOnline: isUserOnline(otherUserId),
    }),
  );
});

router.post(
  "/dms/:threadId/calls/:callId/answer",
  async (req, res): Promise<void> => {
    const threadId = parseThreadId(req.params.threadId);
    const callId = parseThreadId(req.params.callId);
    if (threadId === null || callId === null) {
      res.status(404).json({ error: "Call not found" });
      return;
    }

    const userId = req.userId!;
    const [call] = await db
      .select()
      .from(dmCallsTable)
      .where(eq(dmCallsTable.id, callId));
    if (!call || call.threadId !== threadId || call.status !== "ringing") {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    if (call.callerId === userId) {
      res.status(403).json({ error: "The caller can't answer their own call" });
      return;
    }

    const [thread] = await db
      .select()
      .from(dmThreadsTable)
      .where(eq(dmThreadsTable.id, threadId));
    if (!thread || (thread.userAId !== userId && thread.userBId !== userId)) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }

    clearRingTimeout(callId);
    await db
      .update(dmCallsTable)
      .set({ status: "answered", answeredAt: new Date() })
      .where(eq(dmCallsTable.id, callId));

    sendToUserGlobal(call.callerId, {
      type: "call-answered",
      callId: String(callId),
    });

    res.json({ ok: true });
  },
);

router.post(
  "/dms/:threadId/calls/:callId/decline",
  async (req, res): Promise<void> => {
    const threadId = parseThreadId(req.params.threadId);
    const callId = parseThreadId(req.params.callId);
    if (threadId === null || callId === null) {
      res.status(404).json({ error: "Call not found" });
      return;
    }

    const userId = req.userId!;
    const [call] = await db
      .select()
      .from(dmCallsTable)
      .where(eq(dmCallsTable.id, callId));
    if (
      !call ||
      call.threadId !== threadId ||
      call.status !== "ringing" ||
      call.callerId === userId
    ) {
      res.status(404).json({ error: "Call not found" });
      return;
    }

    await finalizeDmCall(callId, "declined");
    sendToUserGlobal(call.callerId, {
      type: "call-declined",
      callId: String(callId),
    });

    res.json({ ok: true });
  },
);

router.post(
  "/dms/:threadId/calls/:callId/end",
  async (req, res): Promise<void> => {
    const threadId = parseThreadId(req.params.threadId);
    const callId = parseThreadId(req.params.callId);
    if (threadId === null || callId === null) {
      res.status(404).json({ error: "Call not found" });
      return;
    }

    const userId = req.userId!;
    const [call] = await db
      .select()
      .from(dmCallsTable)
      .where(eq(dmCallsTable.id, callId));
    if (!call || call.threadId !== threadId) {
      res.status(404).json({ error: "Call not found" });
      return;
    }

    const [thread] = await db
      .select()
      .from(dmThreadsTable)
      .where(eq(dmThreadsTable.id, threadId));
    if (!thread || (thread.userAId !== userId && thread.userBId !== userId)) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }

    if (call.status === "ringing") {
      // Either side hanging up before anyone answered — logged the same
      // as a missed call (see finalizeDmCall).
      await finalizeDmCall(callId, "cancelled");
      const otherUserId = otherParticipant(thread, userId);
      sendToUserGlobal(otherUserId, {
        type: "call-cancelled",
        callId: String(callId),
      });
    } else if (call.status === "answered") {
      await finalizeDmCall(callId, "ended");
    }

    res.json({ ok: true });
  },
);

export default router;
