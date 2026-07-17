import { integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { messagesTable } from "./messages";
import { dmMessagesTable } from "./dms";
import { usersTable } from "./users";

// Reactions (👍 etc.) are stored as plaintext emoji, not E2E-encrypted like
// message content. An emoji alone reveals essentially nothing about a
// conversation's content, and encrypting it would mean re-wrapping/sharing
// yet another payload per reaction for no real privacy benefit — the same
// tradeoff most E2E chat apps make for reactions and typing indicators.

export const messageReactionsTable = pgTable(
  "message_reactions",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => messagesTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.messageId, table.userId, table.emoji)],
);

export const dmMessageReactionsTable = pgTable(
  "dm_message_reactions",
  {
    id: serial("id").primaryKey(),
    dmMessageId: integer("dm_message_id")
      .notNull()
      .references(() => dmMessagesTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.dmMessageId, table.userId, table.emoji)],
);

export const insertMessageReactionSchema = createInsertSchema(
  messageReactionsTable,
).omit({ id: true, createdAt: true });
export type InsertMessageReaction = z.infer<typeof insertMessageReactionSchema>;
export type MessageReaction = typeof messageReactionsTable.$inferSelect;

export const insertDmMessageReactionSchema = createInsertSchema(
  dmMessageReactionsTable,
).omit({ id: true, createdAt: true });
export type InsertDmMessageReaction = z.infer<
  typeof insertDmMessageReactionSchema
>;
export type DmMessageReaction = typeof dmMessageReactionsTable.$inferSelect;
