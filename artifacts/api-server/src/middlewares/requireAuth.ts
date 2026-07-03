import type { NextFunction, Request, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Ensures a local `users` row exists for the authenticated Clerk user,
 * creating it on first sight (JIT provisioning) so foreign keys from
 * groups/messages/group_members always resolve.
 */
async function ensureLocalUser(userId: string): Promise<void> {
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (existing) return;

  const clerkUser = await clerkClient.users.getUser(userId);
  const email = clerkUser.emailAddresses.find(
    (addr) => addr.id === clerkUser.primaryEmailAddressId,
  )?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress ?? "";
  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    email ||
    "Family Member";

  await db
    .insert(usersTable)
    .values({
      id: userId,
      email,
      name,
      avatarUrl: clerkUser.imageUrl ?? null,
    })
    .onConflictDoNothing();
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await ensureLocalUser(userId);
  } catch (err) {
    logger.error({ err, userId }, "Failed to provision local user");
    res.status(500).json({ error: "Failed to provision user" });
    return;
  }

  req.userId = userId;
  next();
}
