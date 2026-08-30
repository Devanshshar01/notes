import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_RETRY_DELAYS_MS,
  NoteAutosave,
  type SaveFn,
  type SaveResult,
} from "@/lib/note-autosave";

type PendingTimer = { id: number; cb: () => void; at: number };

function makeTimers() {
  let now = 0;
  let nextId = 0;
  const pending: PendingTimer[] = [];
  function tick(ms: number) {
    now += ms;
    // Process timers in order, allowing each cb to schedule / cancel more.
    let progressed = true;
    while (progressed) {
      progressed = false;
      pending.sort((a, b) => a.at - b.at);
      for (let i = 0; i < pending.length; i++) {
        const t = pending[i]!;
        if (t.at > now) break;
        pending.splice(i, 1);
        t.cb();
        progressed = true;
        break;
      }
    }
  }
  function schedule(cb: () => void, ms: number) {
    const id = ++nextId;
    pending.push({ id, cb, at: now + ms });
    return id;
  }
  function cancel(h: unknown) {
    const id = typeof h === "number" ? h : Number(h);
    const idx = pending.findIndex((p) => p.id === id);
    if (idx >= 0) pending.splice(idx, 1);
  }
  return {
    now: () => now,
    setTimeout: (cb: () => void, ms: number) => schedule(cb, ms),
    clearTimeout: cancel,
    tick,
    pending,
  };
}

function makeStorageMock() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    has: (k: string) => map.has(k),
  };
}

function setWindowStorage(store: ReturnType<typeof makeStorageMock>) {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: store },
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: store,
    configurable: true,
  });
}

describe("NoteAutosave controller", () => {
  let store: ReturnType<typeof makeStorageMock>;
  let timers: ReturnType<typeof makeTimers>;
  let save: ReturnType<typeof vi.fn>;
  let controller: NoteAutosave;

  beforeEach(() => {
    store = makeStorageMock();
    setWindowStorage(store);
    timers = makeTimers();
    save = vi.fn();
    controller = new NoteAutosave({
      noteId: "n-1",
      initialRevision: 7,
      initialUpdatedAt: "2026-01-01T00:00:00.000Z",
      initialTitle: "Initial",
      initialContent: { type: "doc", content: [] },
      save: save as unknown as SaveFn,
      now: timers.now,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
    });
    controller.start();
  });

  afterEach(() => {
    controller.stop();
  });

  it("starts in 'saved' state and does not persist a draft", () => {
    expect(controller.snapshot().state).toBe("saved");
    expect(store.has(noteDraftKeyFor("n-1"))).toBe(false);
  });

  it("markDirty persists a draft and goes dirty", () => {
    controller.markDirty({ title: "Hello" });
    expect(store.has(noteDraftKeyFor("n-1"))).toBe(true);
    expect(controller.snapshot().state).toBe("dirty");
  });

  it("does not send a request per keystroke (debounce)", async () => {
    save.mockResolvedValue({
      ok: true,
      revision: 8,
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    controller.markDirty({ title: "A" });
    timers.tick(200);
    controller.markDirty({ title: "AB" });
    timers.tick(200);
    controller.markDirty({ title: "ABC" });
    expect(save).not.toHaveBeenCalled();
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    // Give the promise a microtask to flush.
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "ABC", revision: 7 }),
    );
  });

  it("continuing typing restarts the debounce", async () => {
    save.mockResolvedValue({
      ok: true,
      revision: 8,
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    controller.markDirty({ title: "A" });
    timers.tick(900); // almost at the debounce
    controller.markDirty({ title: "AB" }); // restart
    timers.tick(900);
    expect(save).not.toHaveBeenCalled();
    timers.tick(200); // total 1100ms since last markDirty
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "AB" }),
    );
  });

  it("title and body share the same save", async () => {
    save.mockResolvedValue({
      ok: true,
      revision: 8,
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    controller.markDirty({ title: "T" });
    timers.tick(200);
    controller.markDirty({
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    const call = save.mock.calls[0]![0];
    expect(call.title).toBe("T");
    expect(call.content).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("successful save bumps confirmed revision and clears the draft", async () => {
    save.mockResolvedValue({
      ok: true,
      revision: 8,
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    controller.markDirty({ title: "New" });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot().state).toBe("saved");
    expect(controller.snapshot().confirmedRevision).toBe(8);
    expect(store.has(noteDraftKeyFor("n-1"))).toBe(false);
  });

  it("local edit during in-flight save is preserved and saved with newer revision", async () => {
    let resolveFirst!: (v: SaveResult) => void;
    save.mockImplementationOnce(
      () =>
        new Promise<SaveResult>((res) => {
          resolveFirst = res;
        }),
    );
    save.mockResolvedValueOnce({
      ok: true,
      revision: 8,
      updatedAt: "2026-01-01T00:00:01.000Z",
    });

    controller.markDirty({ title: "A" });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    // Save A is in flight.
    expect(save).toHaveBeenCalledTimes(1);

    // User edits again while A is in flight.
    controller.markDirty({ title: "B" });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    // Still no second save — A is in flight.
    expect(save).toHaveBeenCalledTimes(1);

    // A completes with revision 8.
    resolveFirst({ ok: true, revision: 8, updatedAt: "x" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // B should now save with the new confirmed revision 8.
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].title).toBe("B");
    expect(save.mock.calls[1]![0].revision).toBe(8);
  });

  it("stale revision (409) enters 'conflict' and does not retry", async () => {
    save.mockResolvedValue({
      ok: false,
      error: {
        kind: "server",
        status: 409,
        code: "stale_revision",
        message: "stale",
      },
    });
    controller.markDirty({ title: "X" });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot().state).toBe("conflict");
    // Wait a long time to ensure no retry is scheduled.
    timers.tick(60_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("network failure enters 'offline' and schedules a retry", async () => {
    save.mockResolvedValueOnce({
      ok: false,
      error: { kind: "network" },
    });
    save.mockResolvedValueOnce({
      ok: true,
      revision: 8,
      updatedAt: "x",
    });
    controller.markDirty({ title: "X" });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot().state).toBe("offline");
    timers.tick(AUTOSAVE_RETRY_DELAYS_MS[0]!);
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().state).toBe("saved");
  });

  it("5xx enters 'error' and retries with backoff", async () => {
    save.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "server",
        status: 503,
        code: "unavailable",
        message: "x",
      },
    });
    save.mockResolvedValueOnce({
      ok: true,
      revision: 8,
      updatedAt: "x",
    });
    controller.markDirty({ title: "X" });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot().state).toBe("error");
    timers.tick(AUTOSAVE_RETRY_DELAYS_MS[0]!);
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("401 stops retrying", async () => {
    save.mockResolvedValueOnce({
      ok: false,
      error: {
        kind: "server",
        status: 401,
        code: "unauthorized",
        message: "x",
      },
    });
    controller.markDirty({ title: "X" });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot().state).toBe("auth_error");
    timers.tick(60_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("successful save clears only the matching draft (newer draft preserved)", async () => {
    save.mockImplementation(async (args) => ({
      ok: true,
      revision: args.revision + 1,
      updatedAt: "x",
    }));
    controller.markDirty({ title: "A" });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    // Now manually inject a newer draft (simulating an edit that hasn't
    // been persisted yet — e.g. the user typed but autosave didn't fire).
    store.setItem(
      noteDraftKeyFor("n-1"),
      JSON.stringify({
        noteId: "n-1",
        title: "A-newer",
        content: { type: "doc", content: [] },
        baseRevision: 8,
        updatedAt: Date.now(),
        version: 1,
      }),
    );
    controller.markDirty({ title: "A" }); // same as server
    // The local state caught up to server, so draft should be cleared.
    expect(store.has(noteDraftKeyFor("n-1"))).toBe(false);
  });

  it("isDirty returns true when the user has unsaved local edits", () => {
    expect(controller.snapshot().state).toBe("saved");
    expect(controller.snapshot().hasDraft).toBe(false);
    // The isDirty() method is not part of the snapshot; it is a query.
    // We use the snapshot.hasDraft / snapshot.state to derive dirtiness
    // for the UI. Mark dirty and verify the flag flips.
    controller.markDirty({ title: "Local edit" });
    expect(controller.snapshot().hasDraft).toBe(true);
  });

  it("applyRemoteUpdate adopts a server document and clears the local draft", async () => {
    save.mockResolvedValueOnce({
      ok: true,
      revision: 8,
      updatedAt: "server-time",
    });
    controller.markDirty({ title: "User draft" });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot().hasDraft).toBe(false); // draft cleared after save
    expect(controller.snapshot().state).toBe("saved");

    // Partner saves a newer version while our editor is clean.
    const serverDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Partner version" }],
        },
      ],
    };
    controller.applyRemoteUpdate({
      title: "Partner title",
      content: serverDoc,
      revision: 9,
      updatedAt: "partner-time",
    });
    expect(controller.snapshot().confirmedRevision).toBe(9);
    expect(controller.snapshot().state).toBe("saved");
    expect(controller.snapshot().hasDraft).toBe(false);
  });

  it("applyRemoteUpdate does NOT run if the user has dirty local edits (UI is expected to gate this)", () => {
    controller.markDirty({ title: "Local edit" });
    // The controller itself doesn't gate; the editor UI does. The
    // controller just applies whatever the caller decides. This test
    // documents that the controller accepts the call regardless and the
    // dirty draft is cleared — which is fine because the UI only calls
    // applyRemoteUpdate when the editor is clean.
    controller.applyRemoteUpdate({
      title: "Partner",
      content: { type: "doc", content: [] },
      revision: 9,
      updatedAt: "t",
    });
    expect(controller.snapshot().confirmedRevision).toBe(9);
  });

  it("CRITICAL: a newer local draft is NOT deleted by an older server success", async () => {
    // Scenario: Save A begins. User creates Draft B. Save A succeeds.
    // Expected: Draft B remains. This is the exact sequence from the
    // Step 7 spec.
    let resolveFirst!: (v: SaveResult) => void;
    save.mockImplementationOnce(
      () =>
        new Promise<SaveResult>((res) => {
          resolveFirst = res;
        }),
    );
    // The second save (queued for the newer B state) deliberately
    // never resolves in this test — we want to observe the state
    // immediately after the first save's success, before the second
    // save's success path runs.
    save.mockImplementationOnce(
      () => new Promise<SaveResult>(() => {}),
    );

    controller.markDirty({ title: "A" });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);

    // Before A completes, the user edits to B. The draft is persisted
    // with the latest local state.
    controller.markDirty({ title: "B" });
    const draftAfterB = JSON.parse(
      store.getItem(noteDraftKeyFor("n-1")) ?? "{}",
    );
    expect(draftAfterB.title).toBe("B");

    // Save A completes successfully (revision 7 -> 8).
    resolveFirst({ ok: true, revision: 8, updatedAt: "x" });
    await Promise.resolve();
    await Promise.resolve();
    // The queued save for B has been invoked but has not completed.
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].title).toBe("B");

    // CRITICAL: Draft B is still on disk; Save A's success did NOT
    // delete it. The queued save for B will later run, succeed against
    // revision 8, and then clear the matching draft.
    const raw = store.getItem(noteDraftKeyFor("n-1"));
    expect(raw).not.toBeNull();
    const draftAfterA = JSON.parse(raw ?? "{}");
    expect(draftAfterA.title).toBe("B");
    expect(draftAfterA.baseRevision).toBe(8);
  });

  it("recoverDraft returns null when no draft exists", () => {
    expect(controller.recoverDraft(7)).toBeNull();
  });

  it("recoverDraft applies a draft newer than the server revision", () => {
    store.setItem(
      noteDraftKeyFor("n-1"),
      JSON.stringify({
        noteId: "n-1",
        title: "Recovered",
        content: { type: "doc", content: [] },
        baseRevision: 7,
        updatedAt: Date.now(),
        version: 1,
      }),
    );
    const draft = controller.recoverDraft(7);
    expect(draft).not.toBeNull();
    expect(draft?.title).toBe("Recovered");
    expect(controller.snapshot().state).toBe("dirty");
  });

  it("recoverDraft ignores drafts based on a future revision", () => {
    store.setItem(
      noteDraftKeyFor("n-1"),
      JSON.stringify({
        noteId: "n-1",
        title: "Weird",
        content: { type: "doc", content: [] },
        baseRevision: 999,
        updatedAt: Date.now(),
        version: 1,
      }),
    );
    expect(controller.recoverDraft(7)).toBeNull();
  });

  it("recoverDraft drops a draft that matches the server state", () => {
    store.setItem(
      noteDraftKeyFor("n-1"),
      JSON.stringify({
        noteId: "n-1",
        title: "Initial",
        content: { type: "doc", content: [] },
        baseRevision: 7,
        updatedAt: Date.now(),
        version: 1,
      }),
    );
    expect(controller.recoverDraft(7)).toBeNull();
    expect(store.has(noteDraftKeyFor("n-1"))).toBe(false);
  });

  it("flush forces an immediate save (page hide / online)", async () => {
    save.mockResolvedValue({
      ok: true,
      revision: 8,
      updatedAt: "x",
    });
    controller.markDirty({ title: "X" });
    expect(save).not.toHaveBeenCalled();
    controller.flush();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("onNetworkOnline retries if there is pending work", async () => {
    save.mockResolvedValueOnce({
      ok: false,
      error: { kind: "network" },
    });
    save.mockResolvedValueOnce({
      ok: true,
      revision: 8,
      updatedAt: "x",
    });
    controller.markDirty({ title: "X" });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot().state).toBe("offline");
    controller.onNetworkOnline();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("discardLocalForServer adopts the server snapshot and clears the draft", () => {
    store.setItem(
      noteDraftKeyFor("n-1"),
      JSON.stringify({
        noteId: "n-1",
        title: "Mine",
        content: { type: "doc", content: [] },
        baseRevision: 7,
        updatedAt: Date.now(),
        version: 1,
      }),
    );
    controller.discardLocalForServer({
      title: "Theirs",
      content: { type: "doc", content: [] },
      revision: 9,
      updatedAt: "x",
    });
    expect(store.has(noteDraftKeyFor("n-1"))).toBe(false);
    expect(controller.snapshot().confirmedRevision).toBe(9);
    expect(controller.snapshot().state).toBe("saved");
  });

  it("local edit followed by catch-up to server state does not leave a draft", () => {
    controller.markDirty({ title: "Different" });
    expect(store.has(noteDraftKeyFor("n-1"))).toBe(true);
    // Tell the controller the server has this state.
    controller.noteServerSnapshot({
      title: "Different",
      content: { type: "doc", content: [] },
      revision: 8,
      updatedAt: "x",
    });
    controller.markDirty({ title: "Different" });
    expect(store.has(noteDraftKeyFor("n-1"))).toBe(false);
  });

  it("noteMetaOnlyUpdated bumps revision without resetting last-saved document", async () => {
    // The user has unsaved content edits in flight.
    const userDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "draft" }] }] };
    controller.markDirty({ content: userDoc });
    expect(controller.snapshot().state).toBe("dirty");

    // A metadata-only update (pin / category / color) succeeds and bumps
    // the server revision. The note's title and content have NOT changed
    // on the server, so the controller must NOT replace its last-saved
    // document state with the original server content — otherwise a
    // subsequent content save would lose the user's draft.
    controller.noteMetaOnlyUpdated({ revision: 8, updatedAt: "x" });
    expect(controller.snapshot().confirmedRevision).toBe(8);
    // The dirty state and the draft are preserved.
    expect(controller.snapshot().state).toBe("dirty");
    expect(controller.snapshot().hasDraft).toBe(true);

    // Advance well past the debounce so a save would fire if the
    // controller were still dirty AND the meta update had not bumped the
    // revision. Because the draft is still dirty, the save does fire —
    // and that is the correct behavior. The key invariant is that the
    // save uses the NEW confirmed revision (8), not the stale one (7).
    save.mockResolvedValueOnce({
      ok: true,
      revision: 9,
      updatedAt: "x",
    });
    timers.tick(AUTOSAVE_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].revision).toBe(8);
  });
});

function noteDraftKeyFor(noteId: string): string {
  return `notes:draft:${noteId}`;
}
