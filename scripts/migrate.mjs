import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

function loadDotenv() {
  let text;
  try {
    text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotenv();

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local or your environment.");
  process.exit(1);
}

const migrationsDir = resolve(process.cwd(), "drizzle");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  for (const file of files) {
    const path = resolve(migrationsDir, file);
    const sql = readFileSync(path, "utf8");
    process.stdout.write(`Applying ${file}... `);
    await client.query(sql);
    console.log("ok");
  }
  console.log(`Done. Applied ${files.length} migration(s).`);
} finally {
  await client.end();
}
