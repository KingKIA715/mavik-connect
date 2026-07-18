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
