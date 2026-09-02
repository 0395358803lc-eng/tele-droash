import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const telegramAccounts = pgTable("telegram_accounts", {
  id: text("id").primaryKey(),
  phoneNumber: text("phone_number").notNull().unique(),
  displayName: text("display_name"),
  username: text("username"),
  status: text("status").notNull().default("disconnected"),
  apiIdEncrypted: text("api_id_encrypted").notNull(),
  apiHashEncrypted: text("api_hash_encrypted").notNull(),
  sessionEncrypted: text("session_encrypted"),
  phoneCodeHashEncrypted: text("phone_code_hash_encrypted"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertTelegramAccountSchema = createInsertSchema(telegramAccounts);
export type InsertTelegramAccount = typeof telegramAccounts.$inferInsert;
export type TelegramAccount = typeof telegramAccounts.$inferSelect;