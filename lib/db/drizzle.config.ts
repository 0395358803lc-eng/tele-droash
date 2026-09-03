import { defineConfig } from "drizzle-kit";
import path from "node:path";

const databasePath = path.resolve(
  process.env.DATABASE_PATH?.trim() ||
    path.join(process.cwd(), "data", "checker.db"),
);

export default defineConfig({
  schema: path.join(import.meta.dirname, "./src/schema/index.ts"),
  dialect: "sqlite",
  dbCredentials: {
    url: databasePath,
  },
});
