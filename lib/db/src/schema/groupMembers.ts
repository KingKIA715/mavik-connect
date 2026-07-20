import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { groupsTable } from "./groups";
import { usersTable } from "./users";

export const groupMembersTable = pgTable(
  "group_members",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => groupsTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Read-receipt tracking, same idea as dm_threads' userA/BLastReadAt:
    // the last time this member marked the group as read. Null means
    // "never opened this group".
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    // When this member pinned the group to the top of their own chat list.
    // Null means "not pinned". Per-member (not a group-wide setting) since
    // pinning is a personal organizational preference, not shared state.
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    // When this member muted notifications for this group. Null means "not
    // muted". Per-member, same reasoning as pinnedAt — muting is a personal
    // preference and never affects whether the member can send/receive
    // messages, only whether this app would surface notifications for them.
    mutedAt: timestamp("muted_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })],
);

export const insertGroupMemberSchema = createInsertSchema(
  groupMembersTable,
).omit({ joinedAt: true });
export type InsertGroupMember = z.infer<typeof insertGroupMemberSchema>;
export type GroupMember = typeof groupMembersTable.$inferSelect;
