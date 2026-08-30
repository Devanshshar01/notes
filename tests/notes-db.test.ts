import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { useTestDatabase } from "./setup";
import { seedIdentity, closePool } from "./seed";
import {
  createNote,
  getAuthorizedNote,
  listActiveNotes,
  softDeleteNote,
  updateNote,
} from "@/server/services/notes-service";
import { HttpError } from "@/server/api/errors";

const ctx = useTestDatabase();

describe("notes service — basic CRUD", () => {
  let userA: string;
  let spaceA: string;
  let userB: string;
  let spaceB: string;

  beforeEach(async () => {
    await ctx.resetData();
    const seeded = await seedIdentity();
    userA = seeded.userA;
    spaceA = seeded.spaceA;
    userB = seeded.userB;
    spaceB = seeded.spaceB;
  });

  it("1. creates a note", async () => {
    const note = await createNote(userA, spaceA, { title: "Hello" });
    expect(note.id).toBeDefined();
    expect(note.title).toBe("Hello");
    expect(note.revision).toBe(1);
    expect(note.spaceId).toBe(spaceA);
    expect(note.createdBy).toBe(userA);
    expect(note.updatedBy).toBe(userA);
    expect(note.archivedAt).toBeNull();
    expect(note.deletedAt).toBeNull();
  });

  it("2. reads a note", async () => {
    const created = await createNote(userA, spaceA, { title: "Read me" });
    const fetched = await getAuthorizedNote(created.id, spaceA);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.title).toBe("Read me");
  });

  it("3. updates a note and bumps revision", async () => {
    const created = await createNote(userA, spaceA, { title: "Old" });
    const updated = await updateNote(userA, spaceA, created.id, {
      revision: 1,
      title: "New",
    });
    expect(updated.title).toBe("New");
    expect(updated.revision).toBe(2);
    expect(updated.updatedBy).toBe(userA);
  });

  it("4. soft-deletes a note (deletedAt is set)", async () => {
    const created = await createNote(userA, spaceA, { title: "Delete me" });
    const result = await softDeleteNote(userA, spaceA, created.id);
    expect(result.deletedAt).toBeTruthy();
    const after = await getAuthorizedNote(created.id, spaceA);
    expect(after).toBeNull();
  });

  it("5. archives a note (archivedAt is set)", async () => {
    const created = await createNote(userA, spaceA, { title: "Archive me" });
    const updated = await updateNote(userA, spaceA, created.id, {
      revision: 1,
      archived: true,
    });
    expect(updated.archivedAt).toBeTruthy();
  });

  it("20. deleted notes do not appear in active list", async () => {
    const n1 = await createNote(userA, spaceA, { title: "keep" });
    const n2 = await createNote(userA, spaceA, { title: "remove" });
    await softDeleteNote(userA, spaceA, n2.id);
    const list = await listActiveNotes(spaceA);
    const ids = list.map((n) => n.id);
    expect(ids).toContain(n1.id);
    expect(ids).not.toContain(n2.id);
  });

  it("20. archived notes do not appear in active list", async () => {
    const n1 = await createNote(userA, spaceA, { title: "active" });
    const n2 = await createNote(userA, spaceA, { title: "archive" });
    await updateNote(userA, spaceA, n2.id, { revision: 1, archived: true });
    const list = await listActiveNotes(spaceA);
    const ids = list.map((n) => n.id);
    expect(ids).toContain(n1.id);
    expect(ids).not.toContain(n2.id);
  });

  it("returns 404 for unknown note in authorized space", async () => {
    await expect(
      updateNote(userA, spaceA, "00000000-0000-0000-0000-000000000000", {
        revision: 0,
        title: "x",
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});

afterAll(async () => {
  await closePool();
});
