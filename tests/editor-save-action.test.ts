import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { useTestDatabase } from "./setup";
import { seedIdentity, closePool } from "./seed";
import {
  createNote,
  getAuthorizedNote,
} from "@/server/services/notes-service";
import { saveNoteContentAction } from "@/lib/notes-actions";

const ctx = useTestDatabase();

describe("saveNoteContentAction — title + content + revision", () => {
  let userA: string;
  let spaceA: string;

  beforeEach(async () => {
    // Defensive: ensure no dev-ui bypass leaks from prior test files.
    delete (process.env as Record<string, string>)["NOTES_DEV_UI"];
    await ctx.resetData();
    const seeded = await seedIdentity();
    userA = seeded.userA;
    spaceA = seeded.spaceA;
    ctx.setIdentity(spaceA, userA);
  });

  it("persists title and content, bumps revision", async () => {
    const created = await createNote(userA, spaceA, { title: "" });
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
    };
    const result = await saveNoteContentAction({
      noteId: created.id,
      revision: created.revision,
      title: "Our first note",
      content: doc,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`save failed: ${JSON.stringify(result.error)}`);
    }
    expect(result.data.revision).toBe(created.revision + 1);

    const fresh = await getAuthorizedNote(created.id, spaceA);
    expect(fresh?.title).toBe("Our first note");
    expect(fresh?.content).toEqual(doc);
  });

  it("rejects when revision is stale (stale_revision)", async () => {
    const created = await createNote(userA, spaceA, { title: "" });
    await saveNoteContentAction({
      noteId: created.id,
      revision: created.revision,
      title: "first",
      content: { type: "doc", content: [] },
    });
    const result = await saveNoteContentAction({
      noteId: created.id,
      revision: created.revision,
      title: "stale",
      content: { type: "doc", content: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("stale_revision");
  });

  it("rejects when not authenticated (401)", async () => {
    const created = await createNote(userA, spaceA, { title: "" });
    ctx.setUnauthenticated();
    const result = await saveNoteContentAction({
      noteId: created.id,
      revision: created.revision,
      title: "x",
      content: { type: "doc", content: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(401);
  });

  it("rejects malformed content shape (422)", async () => {
    const created = await createNote(userA, spaceA, { title: "" });
    const result = await saveNoteContentAction({
      noteId: created.id,
      revision: created.revision,
      title: "x",
      content: { type: "not-a-doc", content: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(422);
  });

  it("rejects foreign note (404, no existence leak)", async () => {
    const seeded = await seedIdentity();
    const created = await createNote(seeded.userB, seeded.spaceB, {
      title: "other",
    });
    const result = await saveNoteContentAction({
      noteId: created.id,
      revision: created.revision,
      title: "hack",
      content: { type: "doc", content: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(404);
  });
});

afterAll(async () => {
  await closePool();
});
