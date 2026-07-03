import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { GetMyProfileResponse, SetMyPublicKeyBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

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

  res.json(GetMyProfileResponse.parse(user));
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

    res.json(GetMyProfileResponse.parse(user));
  },
);

export default router;
