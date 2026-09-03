import { defineConfig } from "drizzle-kit";

const url = process.env["DATABASE_URL"] ?? "postgres://localhost/placeholder";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  schemaFilter: ["notes", "notes_dev_identity", "notes_auth"],
});
