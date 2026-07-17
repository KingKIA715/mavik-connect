import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// A log of every time a user's encryption public key was set (first setup,
// or a rotation on a new browser/device). This is NOT a full multi-device
// trust system — the app only ever holds one active keypair per user, so
// there's no way to selectively revoke "just that one device" the way
// Signal-style per-device key registration would allow. What this gives
// the user is visibility: "oh, that's why my other browser stopped
// working" and a rough timeline of when their key changed and from what
// browser/OS, without pretending to offer per-device revoke that the
// current architecture can't actually back up.
export const keyRotationsTable = pgTable("key_rotations", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  userAgent: text("user_agent"),
});

export const insertKeyRotationSchema = createInsertSchema(
  keyRotationsTable,
).omit({ id: true, occurredAt: true });
export type InsertKeyRotation = z.infer<typeof insertKeyRotationSchema>;
export type KeyRotation = typeof keyRotationsTable.$inferSelect;
