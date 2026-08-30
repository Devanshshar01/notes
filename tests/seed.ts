import { Pool } from "pg";
import { randomUUID } from "node:crypto";

const pool = new Pool({
  connectionString: process.env["DATABASE_URL"],
  ssl: { rejectUnauthorized: false },
});

export type Seeded = {
  userA: string;
  userB: string;
  spaceA: string;
  spaceB: string;
};

export async function seedIdentity(): Promise<Seeded> {
  const userA = randomUUID();
  const userB = randomUUID();
  const spaceA = randomUUID();
  const spaceB = randomUUID();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO notes_dev_identity.users (id) VALUES ($1), ($2)`,
      [userA, userB],
    );
    await client.query(
      `INSERT INTO notes_dev_identity.couple_spaces (id) VALUES ($1), ($2)`,
      [spaceA, spaceB],
    );
    await client.query(
      `INSERT INTO notes_dev_identity.memberships (user_id, space_id) VALUES ($1, $2), ($3, $4)`,
      [userA, spaceA, userB, spaceB],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { userA, userB, spaceA, spaceB };
}

export async function closePool(): Promise<void> {
  await pool.end();
}
