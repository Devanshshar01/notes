import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { Client, Pool } from "pg";

let loaded = false;

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const path = resolve(process.cwd(), ".env.local");
  if (existsSync(path)) {
    const parsed = parseDotenv(readFileSync(path, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}

loadEnv();

const baseUrl = process.env["DATABASE_URL"];
if (!baseUrl) throw new Error("DATABASE_URL is required for tests");

let admin: Client | undefined;
let pool: Pool | undefined;

async function applyMigration(): Promise<void> {
  if (!admin) throw new Error("admin not initialised");
  const migrationSql = readFileSync(
    resolve(process.cwd(), "drizzle/0000_initial.sql"),
    "utf8",
  );
  // Idempotent: drop and recreate the dev identity + notes schemas so each
  // test run starts from a clean slate. This is acceptable because the
  // shared database is dedicated to local development + tests.
  await admin.query(`DROP SCHEMA IF EXISTS "notes_dev_identity" CASCADE`);
  await admin.query(`DROP SCHEMA IF EXISTS "notes" CASCADE`);
  await admin.query(migrationSql);
}

export function useTestDatabase(): {
  pool: Pool;
  setIdentity(spaceId: string, userId: string): void;
  setUnauthenticated(): void;
  getCurrentUserId(): string;
  getCurrentSpaceId(): string;
  resetData(): Promise<void>;
} {
  beforeAll(async () => {
    loadEnv();
    admin = new Client({ connectionString: baseUrl, ssl: { rejectUnauthorized: false } });
    await admin.connect();
    await applyMigration();
    pool = new Pool({
      connectionString: baseUrl,
      ssl: { rejectUnauthorized: false },
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) await admin.end();
  });

  let currentUserId = "";
  let currentSpaceId = "";

  function setIdentity(spaceId: string, userId: string): void {
    currentSpaceId = spaceId;
    currentUserId = userId;
    process.env["DEV_AUTH_USER_ID"] = userId;
    process.env["DEV_AUTH_SPACE_ID"] = spaceId;
    (process.env as Record<string, string>)["NODE_ENV"] = "test";
  }

  function setUnauthenticated(): void {
    currentSpaceId = "";
    currentUserId = "";
    delete process.env["DEV_AUTH_USER_ID"];
    delete process.env["DEV_AUTH_SPACE_ID"];
  }

  async function resetData(): Promise<void> {
    if (!pool) throw new Error("pool not ready");
    await pool.query(`TRUNCATE "notes".notes RESTART IDENTITY CASCADE`);
    await pool.query(`TRUNCATE "notes_dev_identity".memberships RESTART IDENTITY CASCADE`);
    await pool.query(`TRUNCATE "notes_dev_identity".users RESTART IDENTITY CASCADE`);
    await pool.query(`TRUNCATE "notes_dev_identity".couple_spaces RESTART IDENTITY CASCADE`);
  }

  return {
    get pool() {
      return pool!;
    },
    setIdentity,
    setUnauthenticated,
    getCurrentUserId: () => currentUserId,
    getCurrentSpaceId: () => currentSpaceId,
    resetData,
  };
}
