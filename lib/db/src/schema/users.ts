import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  // Kept as a derived display name (shown on messages, DM lists, member
  // lists, etc.) so existing consumers of `.name` don't need to change.
  // The server recomputes it from firstName/lastName on every profile
  // update — see PATCH /users/me — rather than letting the two drift apart.
  name: text("name").notNull(),
  // Real profile fields, captured directly in Settings (no Clerk routing,
  // no SMS/OTP verification). Nullable: existing users won't have these
  // set until they save their profile again.
  firstName: text("first_name"),
  lastName: text("last_name"),
  // Plain profile field, format-validated only (E.164, e.g. +14155551234)
  // — not verified to actually belong to the user. See UpdateMyProfileBody
  // in routes/users.ts for the validation.
  phoneNumber: text("phone_number"),
  avatarUrl: text("avatar_url"),
  publicKey: text("public_key"),
  // Recovery backup of the user's E2E private key, encrypted client-side
  // with a key derived (PBKDF2) from a recovery phrase the user is shown
  // exactly once and never transmitted here. The server only ever sees
  // ciphertext — this lets a user restore their SAME keypair (and thus
  // keep decrypting old group/DM keys already wrapped for it) on a brand
  // new device/browser, instead of the only path being "someone who still
  // holds the live key happens to re-share it to you".
  keyBackupCiphertext: text("key_backup_ciphertext"),
  keyBackupSalt: text("key_backup_salt"),
  keyBackupIv: text("key_backup_iv"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
