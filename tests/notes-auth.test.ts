import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { useTestDatabase } from "./setup";
import { seedIdentity, closePool } from "./seed";
import { GET as listNotes, POST as createNoteHttp } from "@/../app/api/notes/route";
import {
  GET as getNote,
  PATCH as patchNote,
  DELETE as deleteNote,
} from "@/../app/api/notes/[id]/route";
import { NextRequest } from "next/server";

const ctx = useTestDatabase();

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as never);
}

describe("notes API — cross-space authorization", () => {
  let userA: string;
  let spaceA: string;
  let userB: string;
  let spaceB: string;

  beforeEach(async () => {
    // Defensive: ensure no dev-ui bypass leaks from prior test files.
    delete (process.env as Record<string, string>)["NOTES_DEV_UI"];
    await ctx.resetData();
    const seeded = await seedIdentity();
    userA = seeded.userA;
    spaceA = seeded.spaceA;
    userB = seeded.userB;
    spaceB = seeded.spaceB;
  });

  it("6. user can list notes in their own Couple Space", async () => {
    ctx.setIdentity(spaceA, userA);
    const created = await createNoteHttp(jsonRequest("http://x/api/notes", "POST", { title: "mine" }));
    expect(created.status).toBe(201);

    const list = await listNotes();
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].title).toBe("mine");
  });

  it("7. user cannot GET another space's note (404, not existence leak)", async () => {
    ctx.setIdentity(spaceB, userB);
    const created = await createNoteHttp(jsonRequest("http://x/api/notes", "POST", { title: "secret" }));
    const body = await created.json();
    const noteId = body.note.id;

    ctx.setIdentity(spaceA, userA);
    const res = await getNote(jsonRequest(`http://x/api/notes/${noteId}`, "GET"), {
      params: Promise.resolve({ id: noteId }),
    });
    expect(res.status).toBe(404);
  });

  it("8. user cannot PATCH another space's note", async () => {
    ctx.setIdentity(spaceB, userB);
    const created = await createNoteHttp(jsonRequest("http://x/api/notes", "POST", { title: "secret" }));
    const body = await created.json();
    const noteId = body.note.id;

    ctx.setIdentity(spaceA, userA);
    const res = await patchNote(
      jsonRequest(`http://x/api/notes/${noteId}`, "PATCH", { revision: 1, title: "hacked" }),
      { params: Promise.resolve({ id: noteId }) },
    );
    expect(res.status).toBe(404);
  });

  it("9. user cannot DELETE another space's note", async () => {
    ctx.setIdentity(spaceB, userB);
    const created = await createNoteHttp(jsonRequest("http://x/api/notes", "POST", { title: "secret" }));
    const body = await created.json();
    const noteId = body.note.id;

    ctx.setIdentity(spaceA, userA);
    const res = await deleteNote(jsonRequest(`http://x/api/notes/${noteId}`, "DELETE"), {
      params: Promise.resolve({ id: noteId }),
    });
    expect(res.status).toBe(404);
  });

  it("10. client-supplied spaceId in body is rejected (no membership bypass)", async () => {
    ctx.setIdentity(spaceA, userA);
    const res = await createNoteHttp(
      jsonRequest("http://x/api/notes", "POST", { spaceId: spaceB, title: "injected" }),
    );
    // The strict schema rejects unknown fields before any authorization
    // decision is made, so no information about the foreign space is
    // disclosed.
    expect(res.status).toBe(422);
  });

  it("10b. client-supplied createdBy / updatedBy cannot impersonate another user", async () => {
    ctx.setIdentity(spaceA, userA);
    // A creates a note in their own space.
    const created = await createNoteHttp(
      jsonRequest("http://x/api/notes", "POST", { title: "mine" }),
    );
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    const noteId = createdBody.note.id;

    // A attempts to PATCH the note with forged createdBy / updatedBy
    // fields. The strict schema rejects unknown fields, so the request
    // is rejected without any server-side identity being set from the
    // client payload. The actual `updatedBy` is always derived from the
    // server-side auth context.
    const res = await patchNote(
      jsonRequest(`http://x/api/notes/${noteId}`, "PATCH", {
        revision: 1,
        title: "hacked",
        createdBy: userB,
        updatedBy: userB,
      }),
      { params: Promise.resolve({ id: noteId }) },
    );
    expect(res.status).toBe(422);

    // The note's real updatedBy is still userA.
    const fresh = await getNote(
      jsonRequest(`http://x/api/notes/${noteId}`, "GET"),
      { params: Promise.resolve({ id: noteId }) },
    );
    const freshBody = await fresh.json();
    expect(freshBody.note.updatedBy).toBe(userA);
    expect(freshBody.note.title).toBe("mine");
  });

  it("401 returned when not authenticated", async () => {
    ctx.setUnauthenticated();
    const res = await listNotes();
    expect(res.status).toBe(401);
  });

  it("403 returned when authenticated but not a member of any space", async () => {
    process.env["DEV_AUTH_USER_ID"] = "00000000-0000-0000-0000-000000000000";
    process.env["DEV_AUTH_SPACE_ID"] = spaceB;
    (process.env as Record<string,string>)["NODE_ENV"] = "test";
    const res = await listNotes();
    expect(res.status).toBe(403);
  });
});

afterAll(async () => {
  await closePool();
});
