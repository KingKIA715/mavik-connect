import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  usersTable,
  groupKeysTable,
  dmKeysTable,
  keyRotationsTable,
} from "@workspace/db";
import {
  GetMyProfileResponse,
  SearchUserByEmailResponse,
  SetMyPublicKeyBody,
  UpdateMyProfileBody,
  GetKeyHistoryResponseItem,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { toIso } from "../lib/serialize";

const router: IRouter = Router();

router.get("/users/search", requireAuth, async (req, res): Promise<void> => {
  const email = typeof req.query.email === "string" ? req.query.email : undefined;
  if (!email) {
    res.status(404).json({ error: "No user with that email" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (!user) {
    res.status(404).json({ error: "No user with that email" });
    return;
  }

  res.json(
    SearchUserByEmailResponse.parse({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      publicKey: user.publicKey,
    }),
  );
});

router.get("/users/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(GetMyProfileResponse.parse({ ...user, createdAt: toIso(user.createdAt) }));
});

router.patch("/users/me", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateMyProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ name: parsed.data.name })
    .where(eq(usersTable.id, req.userId!))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(GetMyProfileResponse.parse({ ...user, createdAt: toIso(user.createdAt) }));
});

router.put(
  "/users/me/public-key",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = SetMyPublicKeyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select({ publicKey: usersTable.publicKey })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!));

    const isRotation =
      !!existing?.publicKey && existing.publicKey !== parsed.data.publicKey;

    const [user] = await db
      .update(usersTable)
      .set({ publicKey: parsed.data.publicKey })
      .where(eq(usersTable.id, req.userId!))
      .returning();

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (isRotation) {
      // This user's public key changed (e.g. they opened the app in a new
      // browser/device with no saved private key, so a fresh keypair got
      // generated). Every wrapped group/DM key already stored for them was
      // wrapped for their OLD public key and is now cryptographically
      // useless — deleting these rows makes them look like they have no
      // key again, which is exactly what re-triggers the existing
      // re-share logic (in ChatRoom.tsx / DmThread.tsx) the next time any
      // other member who still holds the live decrypted key opens that
      // chat. This does NOT recover anything by itself — it just clears
      // the stale state so the normal "share key with someone who doesn't
      // have it yet" flow can do its job again.
      await db.delete(groupKeysTable).where(eq(groupKeysTable.userId, req.userId!));
      await db.delete(dmKeysTable).where(eq(dmKeysTable.userId, req.userId!));
    }

    // Log every time a key gets set (first setup or a rotation) so the
    // user can see a rough "when/where" timeline in Settings. See the
    // schema comment on keyRotationsTable for why this isn't a full
    // per-device trust/revoke system.
    await db.insert(keyRotationsTable).values({
      userId: req.userId!,
      userAgent: req.headers["user-agent"] ?? null,
    });

    res.json(GetMyProfileResponse.parse({ ...user, createdAt: toIso(user.createdAt) }));
  },
);

router.get(
  "/users/me/key-history",
  requireAuth,
  async (req, res): Promise<void> => {
    const rows = await db
      .select({
        occurredAt: keyRotationsTable.occurredAt,
        userAgent: keyRotationsTable.userAgent,
      })
      .from(keyRotationsTable)
      .where(eq(keyRotationsTable.userId, req.userId!))
      .orderBy(desc(keyRotationsTable.occurredAt))
      .limit(20);

    res.json(
      rows.map((row) =>
        GetKeyHistoryResponseItem.parse({
          occurredAt: toIso(row.occurredAt),
          userAgent: row.userAgent,
        }),
      ),
    );
  },
);

export default router;
