import {
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * A 1:1 conversation between two users. userAId/userBId are always stored in
 * a canonical order (userAId < userBId, string comparison on the Clerk user
 * id) so that a lookup for "the thread between X and Y" is a single unique
 * row regardless of who initiated it — enforced by the app layer in
 * lib/dmAccess.ts, and backed here by a unique constraint as a safety net.
 */
export const dmThreadsTable = pgTable(
  "dm_threads",
  {
    id: serial("id").primaryKey(),
    userAId: text("user_a_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    userBId: text("user_b_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.userAId, table.userBId)],
);

export const dmMessagesTable = pgTable("dm_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id")
    .notNull()
    .references(() => dmThreadsTable.id, { onDelete: "cascade" }),
  senderId: text("sender_id")
    .notNull()
    .references(() => usersTable.id),
  content: text("content").notNull(),
  type: text("type").notNull().default("text"),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Mirrors groupKeysTable exactly, one wrapped copy of the thread's AES key per participant. */
export const dmKeysTable = pgTable(
  "dm_keys",
  {
    threadId: integer("thread_id")
      .notNull()
      .references(() => dmThreadsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    wrappedKey: text("wrapped_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.userId] })],
);

export const insertDmThreadSchema = createInsertSchema(dmThreadsTable).omit({
  id: true,
  createdAt: true,
});
export const insertDmMessageSchema = createInsertSchema(dmMessagesTable).omit({
  id: true,
  createdAt: true,
});
export const insertDmKeySchema = createInsertSchema(dmKeysTable).omit({
  createdAt: true,
});

export type InsertDmThread = z.infer<typeof insertDmThreadSchema>;
export type DmThread = typeof dmThreadsTable.$inferSelect;
export type InsertDmMessage = z.infer<typeof insertDmMessageSchema>;
export type DmMessage = typeof dmMessagesTable.$inferSelect;
export type InsertDmKey = z.infer<typeof insertDmKeySchema>;
export type DmKey = typeof dmKeysTable.$inferSelect;
