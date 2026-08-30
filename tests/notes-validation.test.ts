import { describe, it, expect } from "vitest";
import {
  createNoteBodySchema,
  updateNoteBodySchema,
} from "@/server/validation/notes";

describe("notes — validation", () => {
  it("14. invalid title (too long) rejected", () => {
    const result = createNoteBodySchema.safeParse({ title: "x".repeat(500) });
    expect(result.success).toBe(false);
  });

  it("15. invalid category rejected", () => {
    const result = createNoteBodySchema.safeParse({ category: "not-a-category" });
    expect(result.success).toBe(false);
  });

  it("15b. every server-allowed category is accepted (incl. 'travel')", () => {
    for (const category of [
      "general",
      "ideas",
      "lists",
      "letters",
      "plans",
      "memories",
      "travel",
    ]) {
      const r = createNoteBodySchema.safeParse({ category });
      expect(r.success, `category ${category} should be accepted`).toBe(true);
    }
  });

  it("15c. excessively large content is rejected (resource abuse guard)", () => {
    // Build a doc with a single text node large enough to exceed the
    // 256 KB content cap.
    const big = "a".repeat(300 * 1024);
    const result = updateNoteBodySchema.safeParse({
      revision: 1,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: big }] },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("15d. reasonable content size is accepted", () => {
    const result = updateNoteBodySchema.safeParse({
      revision: 1,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "a".repeat(10_000) }] },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("16. invalid color rejected", () => {
    const result = createNoteBodySchema.safeParse({ color: "neon-pink" });
    expect(result.success).toBe(false);
  });

  it("17. malformed document JSON rejected", () => {
    const result = createNoteBodySchema.safeParse({
      content: { type: "not-a-doc" },
    });
    expect(result.success).toBe(false);
  });

  it("17b. valid TipTap doc accepted", () => {
    const result = createNoteBodySchema.safeParse({
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    expect(result.success).toBe(true);
  });

  it("18. invalid revision (negative) rejected on update", () => {
    const result = updateNoteBodySchema.safeParse({ revision: -1, title: "x" });
    expect(result.success).toBe(false);
  });

  it("18b. update with only revision (no fields) rejected", () => {
    const result = updateNoteBodySchema.safeParse({ revision: 1 });
    expect(result.success).toBe(false);
  });

  it("extra fields rejected (strict)", () => {
    const result = createNoteBodySchema.safeParse({
      title: "ok",
      randomField: "nope",
    });
    expect(result.success).toBe(false);
  });
});
