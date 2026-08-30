import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { useTestDatabase } from "./setup";
import { seedIdentity, closePool } from "./seed";
import { GET as getChanges } from "@/../app/api/notes/changes/route";
import { GET as getSummary } from "@/../app/api/notes/[id]/summary/route";
import { createNote, softDeleteNote, updateNote } from "@/server/services/notes-service";
import { NextRequest } from "next/server";

const ctx = useTestDatabase();

function getRequest(url: string): NextRequest {
  return new NextRequest(new Request(url, { method: "GET" }) as never);
}

describe("revalidation API — changes feed", () => {
  let userA: string;
  let spaceA: string;
  let userB: string;
  let spaceB: string;

  beforeEach(async () => {
    delete (process.env as Record<string, string>)["NOTES_DEV_UI"];
    await ctx.resetData();
    const seeded = await seedIdentity();
    userA = seeded.userA;
    spaceA = seeded.spaceA;
    userB = seeded.userB;
    spaceB = seeded.spaceB;
  });

  it("returns summaries updated strictly after the cursor", async () => {
    ctx.setIdentity(spaceA, userA);
    const a1 = await createNote(userA, spaceA, { title: "first" });
    const a2 = await createNote(userA, spaceA, { title: "second" });
    // Bump a1 to a newer revision so a1's updatedAt is guaranteed
    // strictly greater than a2's.
    await updateNote(userA, spaceA, a1.id, {
      revision: a1.revision,
      title: "first-updated",
    });
    // Fetch all (no cursor = epoch) and verify both are present.
    const res = await getChanges(
      getRequest("http://x/api/notes/changes?cursor=1970-01-01T00:00:00.000Z"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summaries: Array<{ id: string; title: string; revision: number }> };
    const ids = body.summaries.map((s) => s.id);
    expect(ids).toContain(a2.id);
    expect(ids).toContain(a1.id);
    const a1Summary = body.summaries.find((s) => s.id === a1.id);
    expect(a1Summary?.title).toBe("first-updated");
    expect(a1Summary?.revision).toBe(2);
  });

  it("filters out summaries whose updatedAt is at or before the cursor", async () => {
    ctx.setIdentity(spaceA, userA);
    const a1 = await createNote(userA, spaceA, { title: "old" });
    // Capture the server's "now" from the first response, which is
    // strictly after a1's stored updated_at (Postgres keeps microsecond
    // precision; the API trims to ms). Using the server's timestamp
    // avoids a millisecond-precision race.
    const first = await getChanges(
      getRequest("http://x/api/notes/changes?cursor=1970-01-01T00:00:00.000Z"),
    );
    const firstBody = (await first.json()) as { now: string };
    const cursor = firstBody.now;

    await new Promise((r) => setTimeout(r, 20));
    const a2 = await createNote(userA, spaceA, { title: "new" });

    const res = await getChanges(
      getRequest(`http://x/api/notes/changes?cursor=${encodeURIComponent(cursor)}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summaries: Array<{ id: string }> };
    const ids = body.summaries.map((s) => s.id);
    expect(ids).toContain(a2.id);
    expect(ids).not.toContain(a1.id);
  });

  it("returns 401 when not authenticated", async () => {
    ctx.setUnauthenticated();
    const res = await getChanges(
      getRequest("http://x/api/notes/changes?cursor=1970-01-01T00:00:00.000Z"),
    );
    expect(res.status).toBe(401);
  });

  it("excludes soft-deleted notes from the changes feed", async () => {
    ctx.setIdentity(spaceA, userA);
    const live = await createNote(userA, spaceA, { title: "survives" });
    const doomed = await createNote(userA, spaceA, { title: "will-be-deleted" });
    await softDeleteNote(userA, spaceA, doomed.id);
    const res = await getChanges(
      getRequest("http://x/api/notes/changes?cursor=1970-01-01T00:00:00.000Z"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summaries: Array<{ id: string }> };
    const ids = body.summaries.map((s) => s.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(doomed.id);
  });
});

describe("revalidation API — note summary", () => {
  let userA: string;
  let spaceA: string;
  let userB: string;
  let spaceB: string;

  beforeEach(async () => {
    delete (process.env as Record<string, string>)["NOTES_DEV_UI"];
    await ctx.resetData();
    const seeded = await seedIdentity();
    userA = seeded.userA;
    spaceA = seeded.spaceA;
    userB = seeded.userB;
    spaceB = seeded.spaceB;
  });

  it("returns metadata without the content body for an authorized note", async () => {
    ctx.setIdentity(spaceA, userA);
    const a = await createNote(userA, spaceA, { title: "secret title" });
    const res = await getSummary(
      getRequest("http://x/api/notes/" + a.id + "/summary"),
      { params: Promise.resolve({ id: a.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: Record<string, unknown> };
    expect(body.summary["title"]).toBe("secret title");
    expect(body.summary["revision"]).toBe(1);
    // Must NOT include the content body.
    expect(body.summary).not.toHaveProperty("content");
  });

  it("returns 404 for a note in another Couple Space (no existence leak)", async () => {
    ctx.setIdentity(spaceB, userB);
    const b = await createNote(userB, spaceB, { title: "B's note" });

    ctx.setIdentity(spaceA, userA);
    const res = await getSummary(
      getRequest("http://x/api/notes/" + b.id + "/summary"),
      { params: Promise.resolve({ id: b.id }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 when not authenticated", async () => {
    ctx.setUnauthenticated();
    const res = await getSummary(
      getRequest("http://x/api/notes/00000000-0000-0000-0000-000000000000/summary"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(res.status).toBe(401);
  });
});

afterAll(async () => {
  await closePool();
});
