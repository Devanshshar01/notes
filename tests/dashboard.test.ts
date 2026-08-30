import { describe, expect, it } from "vitest";
import { applyNoteFilter, splitPinnedAndOthers } from "@/lib/note-filter";
import { extractNotePreview } from "@/lib/note-preview";
import { CATEGORY_OPTIONS, categoryLabel, colorMeta } from "@/lib/note-meta";
import { formatRelativeTime } from "@/lib/relative-time";
import { noteCategories, noteColors } from "@/server/db/schema";
import type { NoteDto } from "@/server/services/notes-service";

function makeNote(overrides: Partial<NoteDto> = {}): NoteDto {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    spaceId: crypto.randomUUID(),
    title: "",
    content: { type: "doc", content: [] },
    isPinned: false,
    color: "none",
    category: "general",
    createdBy: crypto.randomUUID(),
    updatedBy: crypto.randomUUID(),
    revision: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("extractNotePreview", () => {
  it("returns plain text from a paragraph tree", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world" },
          ],
        },
      ],
    };
    expect(extractNotePreview(content)).toBe("Hello world");
  });

  it("joins multiple paragraphs with spaces", () => {
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "One" }] },
        { type: "paragraph", content: [{ type: "text", text: "Two" }] },
      ],
    };
    expect(extractNotePreview(content)).toBe("One Two");
  });

  it("truncates with ellipsis when over the limit", () => {
    const long = "a".repeat(500);
    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: long }] }],
    };
    const out = extractNotePreview(content);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(160);
  });

  it("returns empty string for malformed content without throwing", () => {
    expect(extractNotePreview(null)).toBe("");
    expect(extractNotePreview(undefined)).toBe("");
    expect(extractNotePreview({})).toBe("");
    expect(extractNotePreview({ type: "doc" })).toBe("");
    expect(extractNotePreview({ type: "doc", content: "not an array" })).toBe(
      "",
    );
    expect(
      extractNotePreview({ type: "doc", content: [{ broken: true }] }),
    ).toBe("");
    expect(extractNotePreview(42)).toBe("");
  });
});

describe("note meta", () => {
  it("categoryLabel maps every server-allowed category", () => {
    for (const c of noteCategories) {
      expect(categoryLabel(c)).toBeTruthy();
    }
  });

  it("categoryLabel falls back to General for unknown values", () => {
    expect(categoryLabel("not-a-category")).toBe("General");
  });

  it("colorMeta maps every server-allowed color", () => {
    for (const c of noteColors) {
      const m = colorMeta(c);
      expect(m.value).toBe(c);
      expect(m.label).toBeTruthy();
    }
  });

  it("colorMeta falls back to none for unknown values", () => {
    expect(colorMeta("not-a-color").value).toBe("none");
  });

  it("CATEGORY_OPTIONS values are all allowed by the schema", () => {
    for (const opt of CATEGORY_OPTIONS) {
      expect(noteCategories).toContain(opt.value);
    }
  });
});

describe("formatRelativeTime", () => {
  it("returns 'just now' for very recent timestamps", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(
      formatRelativeTime("2026-01-01T11:59:30Z", now),
    ).toBe("just now");
  });

  it("returns minutes for under an hour", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(formatRelativeTime("2026-01-01T11:55:00Z", now)).toBe("5m ago");
  });

  it("returns hours for under a day", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(formatRelativeTime("2026-01-01T09:00:00Z", now)).toBe("3h ago");
  });

  it("returns days for under a week", () => {
    const now = new Date("2026-01-05T12:00:00Z");
    expect(formatRelativeTime("2026-01-03T12:00:00Z", now)).toBe("2d ago");
  });
});

describe("applyNoteFilter + splitPinnedAndOthers", () => {
  const pinnedA = makeNote({
    id: "1",
    title: "Pinned travel",
    isPinned: true,
    category: "travel" as never,
    updatedAt: "2026-01-01T10:00:00.000Z",
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Japan trip" }] },
      ],
    },
  });
  const oldRecent = makeNote({
    id: "2",
    title: "Old note",
    isPinned: false,
    category: "memories" as never,
    updatedAt: "2026-01-01T08:00:00.000Z",
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Anniversary" }] },
      ],
    },
  });
  const newRecent = makeNote({
    id: "3",
    title: "New note",
    isPinned: false,
    category: "general" as never,
    updatedAt: "2026-01-02T09:00:00.000Z",
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Groceries" }] },
      ],
    },
  });
  const all = [pinnedA, oldRecent, newRecent];

  it("keeps pinned notes first regardless of updatedAt", () => {
    const out = applyNoteFilter(all, { search: "", category: null });
    expect(out.map((n) => n.id)).toEqual(["1", "3", "2"]);
  });

  it("search matches title", () => {
    const out = applyNoteFilter(all, { search: "old", category: null });
    expect(out.map((n) => n.id)).toEqual(["2"]);
  });

  it("search matches body text", () => {
    const out = applyNoteFilter(all, { search: "japan", category: null });
    expect(out.map((n) => n.id)).toEqual(["1"]);
  });

  it("search is case-insensitive", () => {
    const out = applyNoteFilter(all, { search: "JAPAN", category: null });
    expect(out.map((n) => n.id)).toEqual(["1"]);
  });

  it("filters by category", () => {
    const out = applyNoteFilter(all, { search: "", category: "general" });
    expect(out.map((n) => n.id)).toEqual(["3"]);
  });

  it("search + category compose", () => {
    const onlyTravel = applyNoteFilter(all, { search: "", category: "travel" });
    expect(onlyTravel.map((n) => n.id)).toEqual(["1"]);
    const travelButNoJapan = applyNoteFilter(all, {
      search: "japan",
      category: "memories",
    });
    expect(travelButNoJapan).toEqual([]);
  });

  it("splitPinnedAndOthers separates the two groups", () => {
    const split = splitPinnedAndOthers(
      applyNoteFilter(all, { search: "", category: null }),
    );
    expect(split.pinned.map((n) => n.id)).toEqual(["1"]);
    expect(split.others.map((n) => n.id)).toEqual(["3", "2"]);
  });
});
