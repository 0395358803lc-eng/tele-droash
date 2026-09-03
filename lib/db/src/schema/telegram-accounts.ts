import { createInsertSchema } from "drizzle-zod";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const telegramAccounts = sqliteTable("telegram_accounts", {
  id: text("id").primaryKey(),
  phoneNumber: text("phone_number").notNull().unique(),
  displayName: text("display_name"),
  username: text("username"),
  status: text("status").notNull().default("disconnected"),
  apiIdEncrypted: text("api_id_encrypted").notNull(),
  apiHashEncrypted: text("api_hash_encrypted").notNull(),
  sessionEncrypted: text("session_encrypted"),
  phoneCodeHashEncrypted: text("phone_code_hash_encrypted"),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const insertTelegramAccountSchema = createInsertSchema(telegramAccounts);
export type InsertTelegramAccount = typeof telegramAccounts.$inferInsert;
export type TelegramAccount = typeof telegramAccounts.$inferSelect;
