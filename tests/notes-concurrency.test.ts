import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { useTestDatabase } from "./setup";
import { seedIdentity, closePool } from "./seed";
import {
  createNote,
  updateNote,
  getAuthorizedNote,
} from "@/server/services/notes-service";
import { HttpError } from "@/server/api/errors";

const ctx = useTestDatabase();

describe("notes — revision / concurrency", () => {
  let userA: string;
  let spaceA: string;

  beforeEach(async () => {
    await ctx.resetData();
    const seeded = await seedIdentity();
    userA = seeded.userA;
    spaceA = seeded.spaceA;
  });

  it("11. revision increments from 1 to 2 on update", async () => {
    const created = await createNote(userA, spaceA, { title: "v1" });
    expect(created.revision).toBe(1);
    const updated = await updateNote(userA, spaceA, created.id, {
      revision: 1,
      title: "v2",
    });
    expect(updated.revision).toBe(2);
  });

  it("12. stale revision is rejected with 409 conflict", async () => {
    const created = await createNote(userA, spaceA, { title: "v1" });
    // First update succeeds, revision becomes 2.
    await updateNote(userA, spaceA, created.id, { revision: 1, title: "v2" });
    // Second update using stale revision 1 should fail.
    await expect(
      updateNote(userA, spaceA, created.id, { revision: 1, title: "v2-stale" }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("13. stale update cannot overwrite newer content", async () => {
    const created = await createNote(userA, spaceA, { title: "v1" });
    await updateNote(userA, spaceA, created.id, { revision: 1, title: "v2" });
    await updateNote(userA, spaceA, created.id, { revision: 2, title: "v3" });

    // Attempt stale save with revision 1.
    try {
      await updateNote(userA, spaceA, created.id, { revision: 1, title: "stale-poison" });
      throw new Error("expected stale conflict");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
    }

    const current = await getAuthorizedNote(created.id, spaceA);
    expect(current?.title).toBe("v3");
    expect(current?.revision).toBe(3);
  });
});

afterAll(async () => {
  await closePool();
});
