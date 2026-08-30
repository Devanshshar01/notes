import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { loadEnv } from "@/server/env";
import * as schema from "@/server/db/schema";

loadEnv();

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.local (see .env.example).",
  );
}

declare global {
  // eslint-disable-next-line no-var
  var __notesPgPool: Pool | undefined;
}

function createPool(): Pool {
  return new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });
}

export const pool: Pool = globalThis.__notesPgPool ?? createPool();
if (process.env["NODE_ENV"] !== "production") {
  globalThis.__notesPgPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };
