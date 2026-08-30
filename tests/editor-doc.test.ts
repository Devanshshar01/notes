import { describe, expect, it } from "vitest";
import { coerceNoteDocument, DEFAULT_NOTE_DOCUMENT } from "@/lib/note-document";

describe("coerceNoteDocument", () => {
  it("accepts a typical TipTap doc", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    };
    const r = coerceNoteDocument(doc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toBe(doc);
  });

  it("accepts a doc with empty content", () => {
    const doc = { type: "doc", content: [] };
    const r = coerceNoteDocument(doc);
    expect(r.ok).toBe(true);
  });

  it("rejects null / undefined / primitives without throwing", () => {
    for (const v of [null, undefined, 0, 1, "doc", true, false, []]) {
      const r = coerceNoteDocument(v);
      expect(r.ok).toBe(false);
    }
  });

  it("rejects when type is not 'doc'", () => {
    const r = coerceNoteDocument({ type: "paragraph", content: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects when content is missing or wrong type", () => {
    expect(coerceNoteDocument({ type: "doc" }).ok).toBe(false);
    expect(coerceNoteDocument({ type: "doc", content: "nope" }).ok).toBe(false);
    expect(coerceNoteDocument({ type: "doc", content: 42 }).ok).toBe(false);
  });

  it("returns the DEFAULT_NOTE_DOCUMENT shape as a safe fallback reference", () => {
    expect(DEFAULT_NOTE_DOCUMENT).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});
