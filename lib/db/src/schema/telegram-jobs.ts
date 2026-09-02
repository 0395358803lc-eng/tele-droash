import { createInsertSchema } from "drizzle-zod";
import { integer, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { telegramAccounts } from "./telegram-accounts";

export const telegramJobs = pgTable("telegram_jobs", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull().references(() => telegramAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("completed"),
  total: integer("total").notNull(),
  processed: integer("processed").notNull().default(0),
  found: integer("found").notNull().default(0),
  notDiscoverable: integer("not_discoverable").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  accountIndex: index("telegram_jobs_account_id_idx").on(table.accountId),
  updatedIndex: index("telegram_jobs_updated_at_idx").on(table.updatedAt),
}));

export const telegramJobResults = pgTable("telegram_job_results", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => telegramJobs.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),
  status: text("status").notNull(),
  username: text("username"),
  displayName: text("display_name"),
  telegramId: text("telegram_id"),
  lastOnline: text("last_online"),
  errorMessage: text("error_message"),
  retryAfterSeconds: integer("retry_after_seconds"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  jobIndex: index("telegram_job_results_job_id_idx").on(table.jobId),
  jobPhoneUnique: unique("telegram_job_results_job_phone_unique").on(table.jobId, table.phone),
}));

export const insertTelegramJobSchema = createInsertSchema(telegramJobs);
export const insertTelegramJobResultSchema = createInsertSchema(telegramJobResults);
export type InsertTelegramJob = typeof telegramJobs.$inferInsert;
export type TelegramJob = typeof telegramJobs.$inferSelect;
export type InsertTelegramJobResult = typeof telegramJobResults.$inferInsert;
export type TelegramJobResult = typeof telegramJobResults.$inferSelect;