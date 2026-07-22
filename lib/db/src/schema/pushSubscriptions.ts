import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * A single browser/device's Web Push subscription for a user. A user can
 * have several (one per browser/device they've enabled notifications on).
 * `endpoint` is unique per subscription (it encodes the specific browser's
 * push service + registration), so it doubles as the natural dedupe key —
 * re-subscribing the same browser just upserts rather than creating a
 * duplicate row.
 */
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  // Web Push encryption keys, both required by the spec (RFC 8291) —
  // opaque to this app, just forwarded to the web-push library.
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertPushSubscriptionSchema = createInsertSchema(
  pushSubscriptionsTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertPushSubscription = z.infer<
  typeof insertPushSubscriptionSchema
>;
export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
