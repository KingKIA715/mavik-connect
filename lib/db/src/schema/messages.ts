import {
  type AnyPgColumn,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { groupsTable } from "./groups";
import { usersTable } from "./users";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .notNull()
    .references(() => groupsTable.id, { onDelete: "cascade" }),
  senderId: text("sender_id")
    .notNull()
    .references(() => usersTable.id),
  content: text("content").notNull(),
  // "system" messages (e.g. "Jamie left the group.") are server-generated
  // and NOT E2E-encrypted — see the /groups/:groupId/members/:userId
  // handler for where these get inserted. This is a deliberate, narrow
  // exception to "server never sees plaintext": the text is trivial
  // membership-change metadata, not user-authored conversation content.
  type: text("type").notNull().default("text"),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  // Voice messages reuse the file columns above (fileName/mimeType/fileSize
  // for the encrypted audio blob) plus this duration, rather than a
  // separate table — same "just another message type" pattern as `file`.
  durationSeconds: integer("duration_seconds"),
  // Reply/quote: points at the message being replied to, within the same
  // group. Self-referencing FK, so the column must be declared with a
  // callback per Drizzle's convention for self-references. `set null`
  // (rather than cascade) means quoting a message that later gets deleted
  // just loses the quote link — the reply itself stays intact, matching
  // how deletion already preserves the row (soft-delete) elsewhere.
  replyToId: integer("reply_to_id").references(
    (): AnyPgColumn => messagesTable.id,
    { onDelete: "set null" },
  ),
  // @Mentions: plaintext list of member user IDs tagged in this message.
  // Message `content` is E2E-encrypted ciphertext the server can't read, so
  // the client separately tells the server who was mentioned (for
  // notification routing/highlighting) — same tradeoff already made for
  // reactions (see messageReactions.ts): this reveals who was tagged, not
  // what was said.
  mentionedUserIds: text("mentioned_user_ids").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;

/**
 * Group calls are intentionally simpler than DM calls (see dms.ts's
 * dmCallsTable): a group call is a shared room, not a 1:1 ring, so there's
 * no per-person "missed" state machine here — just tracking whether a call
 * is currently active for the group (endedAt null) and logging its
 * duration once everyone's left. Lives in this file rather than groups.ts
 * since it needs to reference messagesTable for logMessageId, and
 * messages.ts already imports groupsTable — putting it in groups.ts would
 * create a circular import between the two files.
 */
export const groupCallsTable = pgTable("group_calls", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .notNull()
    .references(() => groupsTable.id, { onDelete: "cascade" }),
  callerId: text("caller_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "audio" | "video"
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Null while the call is still active (at least one participant present).
  endedAt: timestamp("ended_at", { withTimezone: true }),
  // Set once the call has ended and its summary written into messagesTable
  // (type "call") — see finalizeGroupCall in lib/groupCalls.ts.
  logMessageId: integer("log_message_id").references(
    (): AnyPgColumn => messagesTable.id,
    { onDelete: "set null" },
  ),
});

export const insertGroupCallSchema = createInsertSchema(groupCallsTable).omit({
  id: true,
  startedAt: true,
});
export type InsertGroupCall = z.infer<typeof insertGroupCallSchema>;
export type GroupCall = typeof groupCallsTable.$inferSelect;
