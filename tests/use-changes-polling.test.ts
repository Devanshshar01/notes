import { describe, expect, it } from "vitest";
import { __testing } from "@/lib/use-changes-polling";

const { nextBackoff, MIN_BACKOFF_MS, MAX_BACKOFF_MS, BACKOFF_FACTOR } =
  __testing;

describe("nextBackoff (polling)", () => {
  it("clamps below the minimum", () => {
    expect(nextBackoff(0)).toBe(MIN_BACKOFF_MS);
    expect(nextBackoff(MIN_BACKOFF_MS / 2)).toBe(MIN_BACKOFF_MS);
  });

  it("grows by the factor", () => {
    const next = nextBackoff(MIN_BACKOFF_MS);
    expect(next).toBe(MIN_BACKOFF_MS * BACKOFF_FACTOR);
  });

  it("caps at the maximum", () => {
    let v = MIN_BACKOFF_MS;
    for (let i = 0; i < 100; i++) v = nextBackoff(v);
    expect(v).toBe(MAX_BACKOFF_MS);
  });

  it("never exceeds the cap", () => {
    expect(nextBackoff(60_000)).toBe(MAX_BACKOFF_MS);
    expect(nextBackoff(Number.POSITIVE_INFINITY)).toBe(MAX_BACKOFF_MS);
  });
});
