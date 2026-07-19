import {
  type AnyPgColumn,
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
    // Read-receipt tracking: the last time each side marked this thread as
    // read. Two columns (rather than a join table) mirror the existing
    // userA/userB convention above, since a DM thread only ever has exactly
    // 2 participants. Null means "never opened this thread".
    userALastReadAt: timestamp("user_a_last_read_at", { withTimezone: true }),
    userBLastReadAt: timestamp("user_b_last_read_at", { withTimezone: true }),
    // Pinning, same per-side convention as the read-receipt columns above:
    // each participant can pin this thread to the top of their own chat
    // list independently of the other. Null means "not pinned".
    userAPinnedAt: timestamp("user_a_pinned_at", { withTimezone: true }),
    userBPinnedAt: timestamp("user_b_pinned_at", { withTimezone: true }),
    // Message-request flow: userAId/userBId are stored in canonical sorted
    // order (see comment above) so they can't tell us who *started* the
    // conversation — initiatorId tracks that separately. Nullable because
    // pre-existing threads (created before this feature shipped) predate
    // the concept and are backfilled as already-"accepted" below, where
    // initiator no longer matters.
    initiatorId: text("initiator_id").references(() => usersTable.id),
    // "pending": only initiatorId may send messages (possibly several)
    // until the other side accepts or rejects.
    // "accepted": both sides can send freely.
    // "rejected": a *one-directional* permanent block — initiatorId can
    // never send into this thread again, but the other side still can (see
    // canSendDm in dmAccess.ts). Existing threads are backfilled as
    // "accepted" since they already have message history predating this
    // feature.
    status: text("status").notNull().default("accepted"),
  },
  (table) => [unique().on(table.userAId, table.userBId)],
);

export const insertDmThreadSchema = createInsertSchema(dmThreadsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDmThread = z.infer<typeof insertDmThreadSchema>;
export type DmThread = typeof dmThreadsTable.$inferSelect;

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
  // See messagesTable's durationSeconds/replyToId for the reasoning — same
  // voice-message and reply/quote support, mirrored here for DM threads.
  durationSeconds: integer("duration_seconds"),
  replyToId: integer("reply_to_id").references(
    (): AnyPgColumn => dmMessagesTable.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const insertDmMessageSchema = createInsertSchema(dmMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDmMessage = z.infer<typeof insertDmMessageSchema>;
export type DmMessage = typeof dmMessagesTable.$inferSelect;

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

export const insertDmKeySchema = createInsertSchema(dmKeysTable).omit({
  createdAt: true,
});
export type InsertDmKey = z.infer<typeof insertDmKeySchema>;
export type DmKey = typeof dmKeysTable.$inferSelect;
