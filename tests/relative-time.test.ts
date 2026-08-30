import { describe, expect, it } from "vitest";
import { formatRelativeTime, formatFullDate } from "@/lib/relative-time";

const NOW = new Date("2026-03-15T12:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

describe("formatRelativeTime", () => {
  it("returns 'just now' for under 45 seconds", () => {
    expect(formatRelativeTime(iso(0), NOW)).toBe("just now");
    expect(formatRelativeTime(iso(30_000), NOW)).toBe("just now");
  });

  it("returns minutes for under an hour", () => {
    expect(formatRelativeTime(iso(5 * 60_000), NOW)).toBe("5m ago");
    expect(formatRelativeTime(iso(59 * 60_000), NOW)).toBe("59m ago");
  });

  it("returns hours for under a day", () => {
    expect(formatRelativeTime(iso(3 * 60 * 60_000), NOW)).toBe("3h ago");
    expect(formatRelativeTime(iso(23 * 60 * 60_000), NOW)).toBe("23h ago");
  });

  it("returns 'Yesterday' for exactly one calendar day before now", () => {
    const yesterday = new Date(NOW);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(NOW.getHours());
    expect(formatRelativeTime(yesterday.toISOString(), NOW)).toBe("Yesterday");
  });

  it("returns 'Nd ago' for 2-6 calendar days", () => {
    const threeDays = new Date(NOW);
    threeDays.setDate(threeDays.getDate() - 3);
    threeDays.setHours(NOW.getHours());
    expect(formatRelativeTime(threeDays.toISOString(), NOW)).toBe("3d ago");
  });

  it("returns a short date for older notes in the same year", () => {
    const old = new Date("2026-01-12T09:00:00.000Z");
    const now = new Date("2026-03-15T12:00:00.000Z");
    expect(formatRelativeTime(old.toISOString(), now)).toBe("Jan 12");
  });

  it("includes the year for older notes from a different year", () => {
    const old = new Date("2024-11-02T09:00:00.000Z");
    const now = new Date("2026-03-15T12:00:00.000Z");
    const out = formatRelativeTime(old.toISOString(), now);
    expect(out).toMatch(/2024/);
    expect(out).toMatch(/Nov/);
  });

  it("returns an empty string for invalid input", () => {
    expect(formatRelativeTime("not a date", NOW)).toBe("");
    expect(formatRelativeTime("", NOW)).toBe("");
  });

  it("clamps negative offsets to 'just now'", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 5_000).toISOString(), NOW)).toBe(
      "just now",
    );
  });
});

describe("formatFullDate", () => {
  it("uses short date within the same year", () => {
    expect(formatFullDate("2026-02-09T10:00:00.000Z", NOW)).toBe("Feb 9");
  });

  it("includes the year for a different year", () => {
    const out = formatFullDate("2023-07-04T10:00:00.000Z", NOW);
    expect(out).toMatch(/2023/);
    expect(out).toMatch(/Jul/);
  });
});
