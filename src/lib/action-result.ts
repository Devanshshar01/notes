import type { ActionResult } from "@/lib/notes-actions";

/**
 * Call a server action defensively.
 *
 * Next.js 15 server actions can fail in two ways that aren't covered by
 * the action's structured `{ ok, error }` response:
 *
 *  1. The HTTP transport can fail (stale action ID after a hot reload,
 *     transient network error, server crash) — the promise rejects and
 *     `await` throws.
 *  2. The action ID can be evicted from the server's in-memory registry
 *     (e.g. after a deploy) — the response is non-OK with no parseable
 *     `ActionResult` body, so the runtime returns `undefined`.
 *
 * Both of these would otherwise propagate as an `Unhandled Runtime Error`
 * (`Cannot read properties of undefined (reading 'ok')`) and crash the
 * page. This helper turns them into a graceful toast and an `undefined`
 * return so the caller can `return` without dereferencing the result.
 *
 * In the success case the typed `ActionResult` is returned unchanged.
 */
export async function callAction<T>(
  invoke: () => Promise<ActionResult<T>>,
  onTransportError: (message: string) => void,
  fallback: string,
): Promise<ActionResult<T> | undefined> {
  let result: ActionResult<T> | undefined;
  try {
    result = await invoke();
  } catch {
    onTransportError(
      "Couldn't reach the server. Please refresh the page and try again.",
    );
    return undefined;
  }
  if (!result) {
    onTransportError(
      "Couldn't reach the server. Please refresh the page and try again.",
    );
    return undefined;
  }
  if (result.ok) return result;
  onTransportError(humanError(result.error.code, result.error.message, fallback));
  return result;
}

/**
 * Map a structured `ActionErr` to a user-facing toast message. Mirrors the
 * inline helpers previously duplicated in each client component so the
 * wording is consistent across the app.
 */
export function humanError(
  code: string,
  message: string,
  fallback: string,
): string {
  if (code === "unauthorized") return "Please sign in again.";
  if (code === "not_found") return "That note is gone.";
  if (code === "stale_revision")
    return "Note was updated by your partner. Refreshed.";
  if (code === "validation_error") return fallback;
  return message || fallback;
}
