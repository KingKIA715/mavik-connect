import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { groupsTable } from "./groups";
import { usersTable } from "./users";

export const groupKeysTable = pgTable(
  "group_keys",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => groupsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    wrappedKey: text("wrapped_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })],
);

export const insertGroupKeySchema = createInsertSchema(groupKeysTable).omit({
  createdAt: true,
});
export type InsertGroupKey = z.infer<typeof insertGroupKeySchema>;
export type GroupKey = typeof groupKeysTable.$inferSelect;
