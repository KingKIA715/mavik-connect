import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import {
  SubscribeToPushBody,
  UnsubscribeFromPushBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getVapidPublicKey } from "../lib/push";

const router: IRouter = Router();

// The public key needs to be readable before we know who's asking (a
// logged-out visitor's browser can't usefully subscribe anyway, but there's
// no harm in this one being public — it's not a secret, just the server's
// half of the VAPID keypair).
router.get("/push/vapid-public-key", (_req, res): void => {
  res.json({ publicKey: getVapidPublicKey() });
});

router.use(requireAuth);

router.post("/push/subscribe", async (req, res): Promise<void> => {
  const parsed = SubscribeToPushBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;

  await db
    .insert(pushSubscriptionsTable)
    .values({
      userId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: {
        userId,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      },
    });

  res.json({ ok: true });
});

router.delete("/push/subscribe", async (req, res): Promise<void> => {
  const parsed = UnsubscribeFromPushBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = req.userId!;

  await db
    .delete(pushSubscriptionsTable)
    .where(
      and(
        eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint),
        eq(pushSubscriptionsTable.userId, userId),
      ),
    );

  res.json({ ok: true });
});

export default router;
