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
    // Muting, same per-side convention: each participant can silence
    // notifications for this thread independently of the other, without
    // affecting whether they can still send/receive messages. Null means
    // "not muted". (Timestamp rather than a boolean only to match the
    // existing pinned/read-receipt columns' style in this table — the value
    // itself isn't read for anything beyond "is it set".)
    userAMutedAt: timestamp("user_a_muted_at", { withTimezone: true }),
    userBMutedAt: timestamp("user_b_muted_at", { withTimezone: true }),
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

/**
 * Tracks a DM call's lifecycle (ringing -> answered/missed/declined/
 * cancelled -> ended), separately from dmMessagesTable, since a call has
 * mutable state over its lifetime rather than being an append-only entry
 * like a message. Once a call reaches a terminal state, a compact summary
 * gets written into dmMessagesTable (type "call") so it shows up inline in
 * the conversation the same way "system" messages do in groups — see the
 * finalizeDmCall helper in lib/dmCalls.ts.
 */
export const dmCallsTable = pgTable("dm_calls", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id")
    .notNull()
    .references(() => dmThreadsTable.id, { onDelete: "cascade" }),
  callerId: text("caller_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "audio" | "video"
  // "ringing": invite sent, waiting on the callee to answer/decline or for
  //   the ring to time out.
  // "answered": callee joined; call is (or very recently was) in progress.
  // "missed": rang out unanswered (timeout).
  // "declined": callee explicitly declined.
  // "cancelled": caller hung up before the callee answered.
  // "ended": was answered and has since finished — see answeredAt/endedAt
  //   for duration.
  status: text("status").notNull().default("ringing"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  // Set once this call's terminal-state summary has been written into
  // dmMessagesTable — makes finalizing idempotent (safe to call more than
  // once, e.g. from both the timeout and a racing client request).
  logMessageId: integer("log_message_id").references(
    (): AnyPgColumn => dmMessagesTable.id,
    { onDelete: "set null" },
  ),
});

export const insertDmCallSchema = createInsertSchema(dmCallsTable).omit({
  id: true,
  startedAt: true,
});
export type InsertDmCall = z.infer<typeof insertDmCallSchema>;
export type DmCall = typeof dmCallsTable.$inferSelect;

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
