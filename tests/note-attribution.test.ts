import { describe, expect, it } from "vitest";
import {
  attributionAuthor,
  formatAttribution,
} from "@/lib/note-attribution";

describe("attributionAuthor", () => {
  it("returns 'you' when the updatedBy matches the current user", () => {
    expect(attributionAuthor("user-1", "user-1")).toBe("you");
  });

  it("returns 'partner' when the updatedBy differs from the current user", () => {
    expect(attributionAuthor("user-1", "user-2")).toBe("partner");
  });

  it("returns 'partner' when updatedBy is missing", () => {
    expect(attributionAuthor(undefined, "user-1")).toBe("partner");
    expect(attributionAuthor(null, "user-1")).toBe("partner");
  });
});

describe("formatAttribution", () => {
  it("combines author and timestamp for 'you'", () => {
    expect(
      formatAttribution({ author: "you", when: "5m ago" }),
    ).toBe("Edited by you · 5m ago");
  });

  it("combines author and timestamp for 'partner'", () => {
    expect(
      formatAttribution({ author: "partner", when: "Yesterday" }),
    ).toBe("Edited by your partner · Yesterday");
  });

  it("falls back to 'Last edited by …' when timestamp is empty", () => {
    expect(formatAttribution({ author: "you", when: "" })).toBe(
      "Last edited by you",
    );
    expect(formatAttribution({ author: "partner", when: "   " })).toBe(
      "Last edited by your partner",
    );
  });

  it("never exposes the raw userId in the string", () => {
    const out = formatAttribution({ author: "partner", when: "2h ago" });
    expect(out).not.toMatch(/[0-9a-f-]{36}/i);
    expect(out).not.toMatch(/user-1/);
  });
});
