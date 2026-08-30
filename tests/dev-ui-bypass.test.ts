import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { useTestDatabase } from "./setup";
import { seedIdentity, closePool } from "./seed";
import {
  getAuthorizedNote,
  listActiveNotes,
  type NoteDto,
} from "@/server/services/notes-service";
import {
  createNote,
  softDeleteNote,
  updateNote,
  __devUiNotesForTests,
} from "@/server/services/notes-service";
import { getAuthContext } from "@/server/auth/auth-context";
import {
  DEV_UI_SPACE_ID,
  DEV_UI_USER_ID,
  isDevUiMode,
} from "@/server/dev/dev-ui";
import { HttpError } from "@/server/api/errors";

const ctx = useTestDatabase();

describe("NOTES_DEV_UI — dev-only UI access bypass", () => {
  let userA: string;
  let spaceA: string;

  beforeEach(async () => {
    // Always start clean so leftover env from a prior file doesn't poison
    // the rest of the test suite.
    delete (process.env as Record<string, string>)["NOTES_DEV_UI"];
    await ctx.resetData();
    const seeded = await seedIdentity();
    userA = seeded.userA;
    spaceA = seeded.spaceA;
  });

  it("is disabled by default", () => {
    expect(isDevUiMode()).toBe(false);
  });

  it("is enabled when NOTES_DEV_UI=true outside production", () => {
    const prev = process.env["NOTES_DEV_UI"];
    (process.env as Record<string, string>)["NOTES_DEV_UI"] = "true";
    try {
      expect(isDevUiMode()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env["NOTES_DEV_UI"];
      else (process.env as Record<string, string>)["NOTES_DEV_UI"] = prev;
    }
  });

  it("is HARD-disabled in production even if the flag is set", () => {
    const prevUi = process.env["NOTES_DEV_UI"];
    const prevNode = process.env["NODE_ENV"];
    (process.env as Record<string, string>)["NOTES_DEV_UI"] = "true";
    (process.env as Record<string, string>)["NODE_ENV"] = "production";
    try {
      expect(isDevUiMode()).toBe(false);
    } finally {
      if (prevUi === undefined) delete process.env["NOTES_DEV_UI"];
      else (process.env as Record<string, string>)["NOTES_DEV_UI"] = prevUi;
      if (prevNode === undefined)
        delete (process.env as Record<string, string>)["NODE_ENV"];
      else (process.env as Record<string, string>)["NODE_ENV"] = prevNode;
    }
  });

  it("getAuthContext returns the synthetic dev-ui context when enabled", async () => {
    const prevUi = process.env["NOTES_DEV_UI"];
    (process.env as Record<string, string>)["NOTES_DEV_UI"] = "true";
    try {
      const auth = await getAuthContext();
      expect(auth).toEqual({
        userId: DEV_UI_USER_ID,
        spaceId: DEV_UI_SPACE_ID,
      });
    } finally {
      if (prevUi === undefined) delete process.env["NOTES_DEV_UI"];
      else (process.env as Record<string, string>)["NOTES_DEV_UI"] = prevUi;
    }
  });

  it("getAuthContext still requires membership when bypass is OFF", async () => {
    ctx.setUnauthenticated();
    await expect(getAuthContext()).rejects.toMatchObject({ status: 401 });
  });

  it("listActiveNotes returns [] for the dev-ui space (no DB rows created)", async () => {
    const prevUi = process.env["NOTES_DEV_UI"];
    (process.env as Record<string, string>)["NOTES_DEV_UI"] = "true";
    try {
      const notes = await listActiveNotes(DEV_UI_SPACE_ID);
      expect(notes).toEqual([]);
    } finally {
      if (prevUi === undefined) delete process.env["NOTES_DEV_UI"];
      else (process.env as Record<string, string>)["NOTES_DEV_UI"] = prevUi;
    }
  });

  it("listActiveNotes still returns real notes for non dev-ui spaces", async () => {
    await createNote(userA, spaceA, { title: "real" });
    const notes = await listActiveNotes(spaceA);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.title).toBe("real");
  });

  it("getAuthorizedNote returns a synthetic empty note for dev-ui + unknown id (no DB write)", async () => {
    const prevUi = process.env["NOTES_DEV_UI"];
    (process.env as Record<string, string>)["NOTES_DEV_UI"] = "true";
    try {
      const id = "11111111-2222-3333-4444-555555555555";
      const note = await getAuthorizedNote(id, DEV_UI_SPACE_ID);
      expect(note).not.toBeNull();
      const dto = note as NoteDto;
      expect(dto.id).toBe(id);
      expect(dto.spaceId).toBe(DEV_UI_SPACE_ID);
      expect(dto.title).toBe("");
      expect(dto.revision).toBe(1);

      // The synthetic note must NOT have been written to the DB.
      const list = await listActiveNotes(DEV_UI_SPACE_ID);
      expect(list).toEqual([]);
    } finally {
      if (prevUi === undefined) delete process.env["NOTES_DEV_UI"];
      else (process.env as Record<string, string>)["NOTES_DEV_UI"] = prevUi;
    }
  });

  it("getAuthorizedNote prefers a real note over the synthetic one in dev-ui mode", async () => {
    const real = await createNote(userA, spaceA, { title: "real" });
    const prevUi = process.env["NOTES_DEV_UI"];
    (process.env as Record<string, string>)["NOTES_DEV_UI"] = "true";
    try {
      // Real note with a real spaceId is returned as-is, even with the flag on.
      const note = await getAuthorizedNote(real.id, spaceA);
      expect(note?.title).toBe("real");
    } finally {
      if (prevUi === undefined) delete process.env["NOTES_DEV_UI"];
      else (process.env as Record<string, string>)["NOTES_DEV_UI"] = prevUi;
    }
  });

  it("getAuthorizedNote still returns null for non dev-ui spaces even with the flag on", async () => {
    const prevUi = process.env["NOTES_DEV_UI"];
    (process.env as Record<string, string>)["NOTES_DEV_UI"] = "true";
    try {
      const note = await getAuthorizedNote(
        "11111111-2222-3333-4444-555555555555",
        spaceA,
      );
      expect(note).toBeNull();
    } finally {
      if (prevUi === undefined) delete process.env["NOTES_DEV_UI"];
      else (process.env as Record<string, string>)["NOTES_DEV_UI"] = prevUi;
    }
  });

  describe("write paths in dev-UI mode", () => {
    const setUi = (value: "true" | undefined) => {
      if (value === undefined) {
        delete (process.env as Record<string, string>)["NOTES_DEV_UI"];
      } else {
        (process.env as Record<string, string>)["NOTES_DEV_UI"] = value;
      }
    };
    const restoreUi = (prev: string | undefined) => {
      if (prev === undefined) delete (process.env as Record<string, string>)["NOTES_DEV_UI"];
      else (process.env as Record<string, string>)["NOTES_DEV_UI"] = prev;
    };

    it("createNote returns a fresh dev-UI note (no DB row, no Postgres call)", async () => {
      const prev = process.env["NOTES_DEV_UI"];
      setUi("true");
      try {
        __devUiNotesForTests.clear();
        const note = await createNote(DEV_UI_USER_ID, DEV_UI_SPACE_ID, {
          title: "",
          category: "general",
          color: "none",
        });
        expect(note.spaceId).toBe(DEV_UI_SPACE_ID);
        expect(note.revision).toBe(1);
        expect(note.createdBy).toBe(DEV_UI_USER_ID);
        // The dashboard list still hides dev-UI notes.
        expect(await listActiveNotes(DEV_UI_SPACE_ID)).toEqual([]);
      } finally {
        restoreUi(prev);
      }
    });

    it("updateNote bumps revision on a dev-UI note without touching the DB", async () => {
      const prev = process.env["NOTES_DEV_UI"];
      setUi("true");
      try {
        __devUiNotesForTests.clear();
        const note = await createNote(DEV_UI_USER_ID, DEV_UI_SPACE_ID, {
          title: "",
        });
        const updated = await updateNote(DEV_UI_USER_ID, DEV_UI_SPACE_ID, note.id, {
          revision: note.revision,
          title: "hello",
        });
        expect(updated.title).toBe("hello");
        expect(updated.revision).toBe(2);
        // Read-back goes through the in-memory store.
        const round = await getAuthorizedNote(note.id, DEV_UI_SPACE_ID);
        expect(round?.title).toBe("hello");
        expect(round?.revision).toBe(2);
        // The dashboard list still hides dev-UI notes.
        expect(await listActiveNotes(DEV_UI_SPACE_ID)).toEqual([]);
      } finally {
        restoreUi(prev);
      }
    });

    it("updateNote throws 404 for a non-UUID noteId in dev-UI mode", async () => {
      const prev = process.env["NOTES_DEV_UI"];
      setUi("true");
      try {
        await expect(
          updateNote(DEV_UI_USER_ID, DEV_UI_SPACE_ID, "not-a-uuid", {
            revision: 1,
            title: "x",
          }),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        restoreUi(prev);
      }
    });

    it("updateNote throws a conflict when the client revision is stale (dev-UI mode)", async () => {
      const prev = process.env["NOTES_DEV_UI"];
      setUi("true");
      try {
        __devUiNotesForTests.clear();
        const note = await createNote(DEV_UI_USER_ID, DEV_UI_SPACE_ID, {
          title: "",
        });
        await updateNote(DEV_UI_USER_ID, DEV_UI_SPACE_ID, note.id, {
          revision: 1,
          title: "first",
        });
        let caught: unknown;
        try {
          await updateNote(DEV_UI_USER_ID, DEV_UI_SPACE_ID, note.id, {
            revision: 1, // stale
            title: "second",
          });
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(HttpError);
        expect((caught as HttpError).status).toBe(409);
        expect((caught as HttpError).code).toBe("stale_revision");
      } finally {
        restoreUi(prev);
      }
    });

    it("softDeleteNote marks a dev-UI note deleted and returns a deletedAt timestamp", async () => {
      const prev = process.env["NOTES_DEV_UI"];
      setUi("true");
      try {
        __devUiNotesForTests.clear();
        const note = await createNote(DEV_UI_USER_ID, DEV_UI_SPACE_ID, {
          title: "",
        });
        const out = await softDeleteNote(DEV_UI_USER_ID, DEV_UI_SPACE_ID, note.id);
        expect(out.id).toBe(note.id);
        expect(typeof out.deletedAt).toBe("string");
        expect(new Date(out.deletedAt).toString()).not.toBe("Invalid Date");
      } finally {
        restoreUi(prev);
      }
    });

    it("write paths still hit the real DB when the space is not the dev-UI space", async () => {
      const prev = process.env["NOTES_DEV_UI"];
      setUi("true");
      try {
        __devUiNotesForTests.clear();
        const note = await createNote(userA, spaceA, { title: "real" });
        const updated = await updateNote(userA, spaceA, note.id, {
          revision: 1,
          title: "edited",
        });
        expect(updated.title).toBe("edited");
        const deleted = await softDeleteNote(userA, spaceA, note.id);
        expect(deleted.id).toBe(note.id);
      } finally {
        restoreUi(prev);
      }
    });
  });
});

afterAll(async () => {
  delete (process.env as Record<string, string>)["NOTES_DEV_UI"];
  await closePool();
});
