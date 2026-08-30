"use client";

/**
 * Lightweight revalidation polling for the Notes app.
 *
 * Goals:
 *   - Detect partner updates on the dashboard and on the open note
 *     without character-level collaboration.
 *   - Pause while the document is hidden (mobile battery / network).
 *   - Use a bounded backoff when requests fail.
 *   - Clean up timers and listeners on unmount.
 *
 * No WebSockets, no SSE, no realtime transport. Just a periodic fetch.
 */

import { useEffect, useRef } from "react";

export const DEFAULT_DASHBOARD_INTERVAL_MS = 3_000;
export const DEFAULT_OPEN_NOTE_INTERVAL_MS = 2_500;
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 15_000;
const BACKOFF_FACTOR = 1.5;

export type PollingConfig = {
  intervalMs?: number;
  enabled: boolean;
};

export type PollingCallbacks<TResult> = {
  onSuccess(result: TResult): void;
  onError?(err: unknown): void;
  /** Called whenever a poll attempt finishes, success or failure. */
  onAttemptEnd?(succeeded: boolean): void;
};

function nextBackoff(current: number): number {
  return Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, current * BACKOFF_FACTOR));
}

/** Exposed for testing. */
export const __testing = { nextBackoff, MIN_BACKOFF_MS, MAX_BACKOFF_MS, BACKOFF_FACTOR };

/**
 * Run a polling loop that fetches `fetcher(cursor)` and calls
 * `callbacks.onSuccess` on success, with bounded exponential backoff on
 * failure. Pauses when `document.visibilityState !== "visible"`.
 */
export function useChangesPolling<TResult>(
  fetcher: (signal: AbortSignal) => Promise<TResult>,
  callbacks: PollingCallbacks<TResult>,
  config: PollingConfig,
): void {
  const fetcherRef = useRef(fetcher);
  const cbRef = useRef(callbacks);
  fetcherRef.current = fetcher;
  cbRef.current = callbacks;

  useEffect(() => {
    if (!config.enabled) return;

    const intervalMs = config.intervalMs ?? DEFAULT_DASHBOARD_INTERVAL_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoff = intervalMs;
    let inFlight: AbortController | null = null;
    let stopped = false;

    async function tick() {
      if (stopped) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        // Reschedule on the next visibility change.
        timer = setTimeout(tick, intervalMs);
        return;
      }
      inFlight = new AbortController();
      try {
        const result = await fetcherRef.current(inFlight.signal);
        if (stopped || inFlight.signal.aborted) return;
        backoff = intervalMs; // success resets
        cbRef.current.onSuccess(result);
        cbRef.current.onAttemptEnd?.(true);
      } catch (err) {
        if (stopped) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        backoff = nextBackoff(backoff);
        cbRef.current.onError?.(err);
        cbRef.current.onAttemptEnd?.(false);
      } finally {
        inFlight = null;
        if (!stopped) {
          timer = setTimeout(tick, backoff);
        }
      }
    }

    function onVisibility() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        // Reset backoff and run immediately on re-show.
        backoff = intervalMs;
        tick();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    // Initial poll (also acts as the first scheduled tick).
    tick();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) inFlight.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [config.enabled, config.intervalMs]);
}
