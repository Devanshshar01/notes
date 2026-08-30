import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const { randomUUID } = require("node:crypto");

function loadDotenv() {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  const out = {};
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
  for (const [k, v] of Object.entries(out)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotenv();

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL not set");

const u = randomUUID();
const s = randomUUID();

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  await c.query('CREATE SCHEMA IF NOT EXISTS notes_dev_identity');
  await c.query("CREATE TABLE IF NOT EXISTS notes_dev_identity.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now())");
  await c.query("CREATE TABLE IF NOT EXISTS notes_dev_identity.couple_spaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now())");
  await c.query("CREATE TABLE IF NOT EXISTS notes_dev_identity.memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES notes_dev_identity.users(id) ON DELETE CASCADE, space_id uuid NOT NULL REFERENCES notes_dev_identity.couple_spaces(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now())");
  await c.query("INSERT INTO notes_dev_identity.users (id) VALUES ($1) ON CONFLICT DO NOTHING", [u]);
  await c.query("INSERT INTO notes_dev_identity.couple_spaces (id) VALUES ($1) ON CONFLICT DO NOTHING", [s]);
  await c.query("INSERT INTO notes_dev_identity.memberships (user_id, space_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [u, s]);
} finally {
  await c.end();
}

const envPath = resolve(process.cwd(), ".env.local");
const env = readFileSync(envPath, "utf8")
  .replace(/^(DEV_AUTH_USER_ID=).*$/m, `$1${u}`)
  .replace(/^(DEV_AUTH_SPACE_ID=).*$/m, `$1${s}`);
writeFileSync(envPath, env, "utf8");

console.log("USER=" + u);
console.log("SPACE=" + s);
