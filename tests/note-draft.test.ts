import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDraft,
  loadDraft,
  makeNoteDraft,
  noteDraftKey,
  saveDraft,
} from "@/lib/note-draft";

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe("note-draft localStorage helpers", () => {
  beforeEach(() => {
    // Provide a memory-backed localStorage for the test.
    const store = createMemoryStorage();
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: store },
      configurable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: store,
      configurable: true,
    });
  });

  it("key is deterministic and namespaced", () => {
    expect(noteDraftKey("abc-123")).toBe("notes:draft:abc-123");
  });

  it("saveDraft / loadDraft round-trip", () => {
    const draft = makeNoteDraft({
      noteId: "n-1",
      title: "Hello",
      content: { type: "doc", content: [] },
      baseRevision: 3,
    });
    expect(saveDraft(draft)).toBe(true);
    const loaded = loadDraft("n-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe("Hello");
    expect(loaded?.baseRevision).toBe(3);
    expect(loaded?.version).toBe(1);
    expect(typeof loaded?.updatedAt).toBe("number");
  });

  it("loadDraft returns null for unknown noteId", () => {
    expect(loadDraft("never-saved")).toBeNull();
  });

  it("clearDraft removes the entry", () => {
    saveDraft(
      makeNoteDraft({
        noteId: "n-1",
        title: "x",
        content: {},
        baseRevision: 1,
      }),
    );
    expect(loadDraft("n-1")).not.toBeNull();
    expect(clearDraft("n-1")).toBe(true);
    expect(loadDraft("n-1")).toBeNull();
  });

  it("loadDraft ignores drafts whose noteId does not match the requested key", () => {
    saveDraft(
      makeNoteDraft({
        noteId: "n-1",
        title: "x",
        content: {},
        baseRevision: 1,
      }),
    );
    expect(loadDraft("n-2")).toBeNull();
  });

  it("loadDraft ignores malformed JSON", () => {
    window.localStorage.setItem(noteDraftKey("n-1"), "{not json");
    expect(loadDraft("n-1")).toBeNull();
  });

  it("loadDraft ignores wrong-shape JSON", () => {
    window.localStorage.setItem(noteDraftKey("n-1"), JSON.stringify({ foo: 1 }));
    expect(loadDraft("n-1")).toBeNull();
  });

  it("does NOT include auth tokens / cookies / secrets in serialized draft", () => {
    const draft = makeNoteDraft({
      noteId: "n-1",
      title: "Hello",
      content: { type: "doc" },
      baseRevision: 1,
    });
    saveDraft(draft);
    const raw = window.localStorage.getItem(noteDraftKey("n-1")) ?? "";
    expect(raw).not.toMatch(/token/i);
    expect(raw).not.toMatch(/cookie/i);
    expect(raw).not.toMatch(/password/i);
    expect(raw).not.toMatch(/secret/i);
  });

  it("saveDraft returns false when storage is unavailable", () => {
    const setItemSpy = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    const ok = saveDraft(
      makeNoteDraft({
        noteId: "n-1",
        title: "x",
        content: {},
        baseRevision: 1,
      }),
    );
    expect(ok).toBe(false);
    setItemSpy.mockRestore();
  });

  it("loadDraft returns null when storage throws", () => {
    const getItemSpy = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(loadDraft("n-1")).toBeNull();
    getItemSpy.mockRestore();
  });
});
