/**
 * Pure autosave controller for a single note.
 *
 * Responsibilities:
 *   - Debounce local edits
 *   - Persist drafts to localStorage on every change
 *   - Send PATCHes with the latest known server revision
 *   - Serialize saves: only one in-flight at a time
 *   - On a stale revision (409), enter `conflict` and let the UI resolve
 *   - On 5xx / network errors, retry with a bounded backoff
 *   - On 401 / 403, stop retrying and surface `auth_error`
 *   - Never overwrite newer unsaved local content with a server response
 */

import {
  clearDraft,
  loadDraft,
  makeNoteDraft,
  saveDraft,
  type NoteDraft,
} from "@/lib/note-draft";

export const AUTOSAVE_DEBOUNCE_MS = 1000;
export const AUTOSAVE_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000] as const;

export type SaveState =
  | "saved"
  | "dirty"
  | "saving"
  | "offline"
  | "error"
  | "auth_error"
  | "conflict";

export type SaveSnapshot = {
  state: SaveState;
  /** Server revision currently confirmed by the server. */
  confirmedRevision: number;
  /** Updated-at returned by the server on the last successful save. */
  serverUpdatedAt: string;
  /** Whether a local draft is currently stored. */
  hasDraft: boolean;
  /** The most recent user-visible error, if any. */
  errorCode?: string;
};

export type SaveError =
  | { kind: "network" }
  | { kind: "server"; status: number; code: string; message: string };

export type SaveResult =
  | { ok: true; revision: number; updatedAt: string }
  | { ok: false; error: SaveError };

export type SaveFn = (args: {
  noteId: string;
  revision: number;
  title: string;
  content: unknown;
}) => Promise<SaveResult>;

type Pending = { title: string; content: unknown };

export type NoteAutosaveOptions = {
  noteId: string;
  initialRevision: number;
  initialUpdatedAt: string;
  initialTitle: string;
  initialContent: unknown;
  save: SaveFn;
  /** Override timers in tests. */
  now?: () => number;
  setTimeout?: (cb: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export class NoteAutosave {
  private noteId: string;
  private save: SaveFn;
  private now: () => number;
  private setTimeout: (cb: () => void, ms: number) => unknown;
  private clearTimeout: (handle: unknown) => void;
  private handles: { debounce: unknown | null; retry: unknown | null } = {
    debounce: null,
    retry: null,
  };
  private retryAttempt = 0;

  private confirmedRevision: number;
  private serverUpdatedAt: string;
  private lastSavedTitle: string;
  private lastSavedContent: unknown;
  private localTitle: string;
  private localContent: unknown;
  private pending: Pending | null = null;
  private inFlight: Pending | null = null;
  private state: SaveState = "saved";
  private errorCode: string | undefined;
  private hasDraft = false;
  private subscribers = new Set<(snap: SaveSnapshot) => void>();
  private started = false;

  constructor(opts: NoteAutosaveOptions) {
    this.noteId = opts.noteId;
    this.save = opts.save;
    this.now = opts.now ?? (() => Date.now());
    this.setTimeout =
      opts.setTimeout ??
      ((cb, ms) => window.setTimeout(cb, ms) as unknown as number);
    this.clearTimeout =
      opts.clearTimeout ??
      ((handle) => window.clearTimeout(handle as number));
    this.confirmedRevision = opts.initialRevision;
    this.serverUpdatedAt = opts.initialUpdatedAt;
    this.lastSavedTitle = opts.initialTitle;
    this.lastSavedContent = opts.initialContent;
    this.localTitle = opts.initialTitle;
    this.localContent = opts.initialContent;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.refreshDraftFlag();
  }

  stop(): void {
    this.started = false;
    this.cancelDebounce();
    this.cancelRetry();
  }

  subscribe(cb: (snap: SaveSnapshot) => void): () => void {
    this.subscribers.add(cb);
    cb(this.snapshot());
    return () => {
      this.subscribers.delete(cb);
    };
  }

  snapshot(): SaveSnapshot {
    return {
      state: this.state,
      confirmedRevision: this.confirmedRevision,
      serverUpdatedAt: this.serverUpdatedAt,
      hasDraft: this.hasDraft,
      errorCode: this.errorCode,
    };
  }

  /**
   * Load any existing draft from localStorage and apply it if it represents
   * unsaved work newer than the server revision. Returns the draft that was
   * applied (or null). The caller is responsible for replacing the editor
   * content with the returned title + content.
   */
  recoverDraft(serverRevision: number): NoteDraft | null {
    const draft = loadDraft(this.noteId);
    if (!draft) return null;
    if (draft.baseRevision > serverRevision) {
      // Draft is based on a future revision we don't have — treat as invalid.
      return null;
    }
    if (this.isSameAsServer(draft.title, draft.content)) {
      // Draft matches current server state; clear it.
      clearDraft(this.noteId);
      this.hasDraft = false;
      this.emit();
      return null;
    }
    // Apply the draft as the local state so subsequent saves use it.
    this.localTitle = draft.title;
    this.localContent = draft.content;
    this.pending = { title: draft.title, content: draft.content };
    this.hasDraft = true;
    this.setState("dirty");
    return draft;
  }

  /**
   * User edited the title or content. Updates local state, persists a draft,
   * and restarts the debounce. Cheap: no JSON deep-clone, no network.
   */
  markDirty(next: { title?: string; content?: unknown }): void {
    if (next.title !== undefined) this.localTitle = next.title;
    if (next.content !== undefined) this.localContent = next.content;
    if (this.isSameAsServer(this.localTitle, this.localContent)) {
      // Local state caught up to server. Clear any draft and idle.
      this.pending = null;
      this.cancelDebounce();
      clearDraft(this.noteId);
      this.hasDraft = false;
      this.setState("saved");
      return;
    }
    this.pending = { title: this.localTitle, content: this.localContent };
    this.persistDraft();
    this.setState("dirty");
    this.restartDebounce();
  }

  /**
   * Force an immediate save (page hide, manual flush, network restore).
   * Safe to call from any state. Cancels the debounce.
   */
  flush(): void {
    this.cancelDebounce();
    if (this.inFlight) {
      // A save is already running. It will pick up the latest `pending` on
      // success (see `applyServerSuccess`).
      return;
    }
    if (!this.pending) return;
    this.startSave(this.pending);
  }

  /**
   * Server snapshot provided externally (e.g. initial load). Updates the
   * confirmed revision AND replaces the last-saved document state. Use this
   * when the server gave us a full new view of the document.
   *
   * For metadata-only updates (pin / category / color) use
   * `noteMetaOnlyUpdated` instead, which bumps the revision without
   * overwriting the last-saved title/content.
   */
  noteServerSnapshot(snap: {
    revision: number;
    updatedAt: string;
    title: string;
    content: unknown;
  }): void {
    this.confirmedRevision = snap.revision;
    this.serverUpdatedAt = snap.updatedAt;
    this.lastSavedTitle = snap.title;
    this.lastSavedContent = snap.content;
    // If a draft exists and matches the new server state, drop it.
    const draft = loadDraft(this.noteId);
    if (draft && this.isSameAsServer(draft.title, draft.content)) {
      clearDraft(this.noteId);
      this.hasDraft = false;
    }
    // If local state already matches the new server, go idle.
    if (
      this.isSameAsServer(this.localTitle, this.localContent) &&
      !this.inFlight
    ) {
      this.pending = null;
      this.cancelDebounce();
      this.setState("saved");
      return;
    }
    this.emit();
  }

  /**
   * Server confirmed a metadata-only update (pin / category / color). The
   * note's title and content were NOT changed by the server, so the
   * controller must NOT overwrite its last-saved document state with the
   * original server props. Only the confirmed revision and updated-at are
   * updated. This prevents the controller from later thinking the user's
   * unsaved content edits have already been persisted.
   */
  noteMetaOnlyUpdated(snap: { revision: number; updatedAt: string }): void {
    this.confirmedRevision = snap.revision;
    this.serverUpdatedAt = snap.updatedAt;
    this.emit();
  }

  /**
   * Indicate that we just received an `online` event from the browser.
   * Triggers a controlled retry if we have pending work and the state is
   * `offline` or `error`.
   */
  onNetworkOnline(): void {
    if (!this.started) return;
    if (this.state === "offline" || this.state === "error") {
      this.cancelRetry();
      this.retryAttempt = 0;
      if (this.inFlight) return;
      if (this.pending) {
        this.startSave(this.pending);
      }
    }
  }

  /**
   * Apply a server-conflict (409) manually — used when the UI already has
   * the latest server snapshot. The draft is preserved.
   */
  enterConflict(serverSnapshot: {
    revision: number;
    updatedAt: string;
    title: string;
    content: unknown;
  }): void {
    this.confirmedRevision = serverSnapshot.revision;
    this.serverUpdatedAt = serverSnapshot.updatedAt;
    this.lastSavedTitle = serverSnapshot.title;
    this.lastSavedContent = serverSnapshot.content;
    this.setState("conflict");
  }

  /**
   * The user has chosen to keep the local draft and retry over the server.
   * Bumps the base revision to the current confirmed one and flushes.
   */
  retryWithCurrentLocal(): void {
    this.pending = { title: this.localTitle, content: this.localContent };
    this.persistDraft();
    this.cancelRetry();
    this.retryAttempt = 0;
    if (this.inFlight) return;
    if (!this.pending) {
      this.setState("saved");
      return;
    }
    this.startSave(this.pending);
  }

  /**
   * The user has chosen to discard the local draft and adopt the server
   * snapshot.
   */
  discardLocalForServer(snap: {
    title: string;
    content: unknown;
    revision: number;
    updatedAt: string;
  }): void {
    clearDraft(this.noteId);
    this.hasDraft = false;
    this.localTitle = snap.title;
    this.localContent = snap.content;
    this.lastSavedTitle = snap.title;
    this.lastSavedContent = snap.content;
    this.confirmedRevision = snap.revision;
    this.serverUpdatedAt = snap.updatedAt;
    this.pending = null;
    this.cancelDebounce();
    this.cancelRetry();
    this.retryAttempt = 0;
    this.setState("saved");
  }

  /**
   * Is the local editor state currently dirty? True when the user has
   * unsaved edits that haven't been confirmed by the server.
   */
  isDirty(): boolean {
    if (this.pending !== null) return true;
    if (this.state === "saving") return true;
    return !this.isSameAsServer(this.localTitle, this.localContent);
  }

  /**
   * Apply a server-authoritative document update received via the
   * lightweight revalidation poll. This is the "partner saved a newer
   * version while the editor was clean" path.
   *
   * The editor's useEffects will pick up the new lastSaved* state and
   * update title/metadata; content is also adopted because the editor
   * is clean. Any existing local draft is cleared (it's stale).
   */
  applyRemoteUpdate(snap: {
    title: string;
    content: unknown;
    revision: number;
    updatedAt: string;
  }): void {
    clearDraft(this.noteId);
    this.hasDraft = false;
    this.localTitle = snap.title;
    this.localContent = snap.content;
    this.lastSavedTitle = snap.title;
    this.lastSavedContent = snap.content;
    this.confirmedRevision = snap.revision;
    this.serverUpdatedAt = snap.updatedAt;
    this.pending = null;
    this.cancelDebounce();
    this.cancelRetry();
    this.retryAttempt = 0;
    this.setState("saved");
  }

  // ── internals ──────────────────────────────────────────────────────────

  private setState(next: SaveState, errorCode?: string): void {
    if (this.state === next && this.errorCode === errorCode) return;
    this.state = next;
    this.errorCode = errorCode;
    this.emit();
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.subscribers) cb(snap);
  }

  private refreshDraftFlag(): void {
    this.hasDraft = loadDraft(this.noteId) !== null;
  }

  private persistDraft(): void {
    const draft = makeNoteDraft({
      noteId: this.noteId,
      title: this.localTitle,
      content: this.localContent,
      baseRevision: this.confirmedRevision,
    });
    this.hasDraft = saveDraft(draft);
    if (!this.hasDraft) {
      // Storage is unavailable. The editor still works; the user will be
      // told via the save status when the next save attempt fails.
    }
  }

  private restartDebounce(): void {
    this.cancelDebounce();
    this.handles.debounce = this.setTimeout(() => {
      this.handles.debounce = null;
      if (this.inFlight) return;
      if (!this.pending) return;
      this.startSave(this.pending);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private cancelDebounce(): void {
    if (this.handles.debounce !== null) {
      this.clearTimeout(this.handles.debounce);
      this.handles.debounce = null;
    }
  }

  private cancelRetry(): void {
    if (this.handles.retry !== null) {
      this.clearTimeout(this.handles.retry);
      this.handles.retry = null;
    }
  }

  private startSave(payload: Pending): void {
    if (this.inFlight) return;
    if (this.state === "auth_error") return; // never retry auth errors
    this.inFlight = payload;
    this.setState("saving");
    void this.runSave(payload);
  }

  private async runSave(payload: Pending): Promise<void> {
    const sentTitle = payload.title;
    const sentContent = payload.content;
    let result: SaveResult;
    try {
      result = await this.save({
        noteId: this.noteId,
        revision: this.confirmedRevision,
        title: sentTitle,
        content: sentContent,
      });
    } catch {
      result = { ok: false, error: { kind: "network" } };
    }
    this.inFlight = null;

    if (result.ok) {
      this.applyServerSuccess(result, sentTitle, sentContent);
      return;
    }
    this.applyServerFailure(result.error);
  }

  private applyServerSuccess(
    result: { revision: number; updatedAt: string },
    sentTitle: string,
    sentContent: unknown,
  ): void {
    this.confirmedRevision = result.revision;
    this.serverUpdatedAt = result.updatedAt;
    this.lastSavedTitle = sentTitle;
    this.lastSavedContent = sentContent;
    this.retryAttempt = 0;
    this.cancelRetry();

    // If local state advanced during the save, persist the newer state and
    // immediately save it using the new confirmed revision. `inFlight` was
    // cleared by `runSave` before this method ran.
    const newer =
      this.pending && !this.payloadsEqual(this.pending, {
        title: sentTitle,
        content: sentContent,
      });
    if (newer && this.pending) {
      this.persistDraft();
      this.setState("saving");
      this.startSave(this.pending);
      return;
    }

    // No newer pending work. Clear the draft (if it matches what we just
    // saved) and go idle.
    this.pending = null;
    const draft = loadDraft(this.noteId);
    if (
      draft &&
      this.payloadsEqual({ title: draft.title, content: draft.content }, {
        title: sentTitle,
        content: sentContent,
      })
    ) {
      clearDraft(this.noteId);
      this.hasDraft = false;
    } else {
      // A newer draft exists; keep it.
      this.hasDraft = draft !== null;
    }
    this.setState("saved");
  }

  private applyServerFailure(error: SaveError): void {
    if (error.kind === "network") {
      this.scheduleRetry();
      this.setState("offline", "network");
      return;
    }
    const status = error.status;
    if (status === 409) {
      // Stale revision. Stop retrying; surface conflict to the UI.
      this.cancelRetry();
      this.setState("conflict", error.code);
      return;
    }
    if (status === 401 || status === 403) {
      this.cancelRetry();
      this.setState("auth_error", error.code);
      return;
    }
    if (status === 404) {
      this.cancelRetry();
      this.setState("error", error.code);
      return;
    }
    if (status >= 400 && status < 500) {
      // Other 4xx — do not blindly retry.
      this.cancelRetry();
      this.setState("error", error.code);
      return;
    }
    // 5xx — retry with backoff.
    this.scheduleRetry();
    this.setState("error", error.code);
  }

  private scheduleRetry(): void {
    this.cancelRetry();
    const delay =
      AUTOSAVE_RETRY_DELAYS_MS[
        Math.min(this.retryAttempt, AUTOSAVE_RETRY_DELAYS_MS.length - 1)
      ] ?? AUTOSAVE_RETRY_DELAYS_MS[AUTOSAVE_RETRY_DELAYS_MS.length - 1]!;
    this.retryAttempt += 1;
    this.handles.retry = this.setTimeout(() => {
      this.handles.retry = null;
      if (this.inFlight) return;
      if (this.state === "auth_error" || this.state === "conflict") return;
      if (this.pending) {
        this.startSave(this.pending);
      }
    }, delay);
  }

  private isSameAsServer(title: string, content: unknown): boolean {
    return this.payloadsEqual(
      { title, content },
      { title: this.lastSavedTitle, content: this.lastSavedContent },
    );
  }

  private payloadsEqual(a: Pending, b: Pending): boolean {
    if (a.title !== b.title) return false;
    return canonicalStringify(a.content) === canonicalStringify(b.content);
  }
}

function canonicalStringify(v: unknown): string {
  // Stable JSON for equality checks. Same-shape objects with same keys in
  // the same order will serialize identically; TipTap content is keyed
  // deterministically by the editor.
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

export type { NoteDraft };
