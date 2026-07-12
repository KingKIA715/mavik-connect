import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  GetMyProfileResponse,
  SetMyPublicKeyBody,
  SearchUserByEmailResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { toIso } from "../lib/serialize";

const router: IRouter = Router();

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

router.put(
  "/users/me/public-key",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = SetMyPublicKeyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [user] = await db
      .update(usersTable)
      .set({ publicKey: parsed.data.publicKey })
      .where(eq(usersTable.id, req.userId!))
      .returning();

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(GetMyProfileResponse.parse({ ...user, createdAt: toIso(user.createdAt) }));
  },
);

router.get("/users/search", requireAuth, async (req, res): Promise<void> => {
  const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
  if (!email) {
    res.status(400).json({ error: "email query parameter is required" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (!user) {
    res.status(404).json({ error: "No user found with that email" });
    return;
  }

  res.json(
    SearchUserByEmailResponse.parse({
      userId: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      publicKey: user.publicKey,
    }),
  );
});

export default router;
