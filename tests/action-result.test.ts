import { describe, expect, it, vi } from "vitest";
import { callAction, humanError } from "@/lib/action-result";

describe("callAction", () => {
  it("returns the action's typed result on success", async () => {
    const result = await callAction(
      async () => ({ ok: true as const, data: { id: "abc" } }),
      () => {},
      "fallback",
    );
    expect(result).toEqual({ ok: true, data: { id: "abc" } });
  });

  it("returns a structured error and invokes onTransportError with the mapped message", async () => {
    const onError = vi.fn();
    const result = await callAction(
      async () => ({
        ok: false as const,
        error: { code: "not_found", message: "nope", status: 404 },
      }),
      onError,
      "fallback for not_found",
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "not_found", message: "nope", status: 404 },
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBe("That note is gone.");
  });

  it("returns undefined and shows a recoverable toast when the action promise rejects", async () => {
    const onError = vi.fn();
    const result = await callAction(
      async () => {
        throw new Error("network down");
      },
      onError,
      "fallback",
    );
    expect(result).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toMatch(/refresh the page/i);
  });

  it("returns undefined and shows a recoverable toast when the action returns undefined (stale action ID)", async () => {
    const onError = vi.fn();
    // Simulate Next.js 15 returning undefined when the action ID is
    // evicted from the server's in-memory registry.
    const result = await callAction(
      async () => undefined as never,
      onError,
      "fallback",
    );
    expect(result).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toMatch(/refresh the page/i);
  });
});

describe("humanError", () => {
  it("maps unauthorized to a sign-in message", () => {
    expect(humanError("unauthorized", "raw", "fb")).toMatch(/sign in/i);
  });

  it("maps not_found to a gone message", () => {
    expect(humanError("not_found", "raw", "fb")).toMatch(/gone/i);
  });

  it("maps stale_revision to a partner message", () => {
    expect(humanError("stale_revision", "raw", "fb")).toMatch(/partner/i);
  });

  it("returns the fallback for validation_error", () => {
    expect(humanError("validation_error", "raw", "fb")).toBe("fb");
  });

  it("returns the raw message for unknown codes when present", () => {
    expect(humanError("something_else", "raw text", "fb")).toBe("raw text");
  });

  it("falls back to the fallback when the message is empty and code is unknown", () => {
    expect(humanError("something_else", "", "fb")).toBe("fb");
  });
});
