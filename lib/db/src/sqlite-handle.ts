import Database from "better-sqlite3";
import { databasePath } from "./path";

export const sqlite: Database.Database = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("synchronous = NORMAL");
