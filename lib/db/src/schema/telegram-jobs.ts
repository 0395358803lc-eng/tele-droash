import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { telegramAccounts } from "./telegram-accounts";

export const telegramJobs = sqliteTable(
  "telegram_jobs",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => telegramAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("queued"),
    total: integer("total").notNull(),
    processed: integer("processed").notNull().default(0),
    found: integer("found").notNull().default(0),
    notDiscoverable: integer("not_discoverable").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    minRequestInterval: real("min_request_interval").notNull().default(1.2),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("telegram_jobs_account_id_idx").on(table.accountId),
    index("telegram_jobs_updated_at_idx").on(table.updatedAt),
  ],
);

export const insertTelegramJobSchema = createInsertSchema(telegramJobs);
export type InsertTelegramJob = typeof telegramJobs.$inferInsert;
export type TelegramJob = typeof telegramJobs.$inferSelect;
