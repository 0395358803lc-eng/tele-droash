import fs from "node:fs";
import path from "node:path";

const configuredPath = process.env.DATABASE_PATH?.trim();
export const databasePath = path.resolve(
  configuredPath || path.join(process.cwd(), "data", "checker.db"),
);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
