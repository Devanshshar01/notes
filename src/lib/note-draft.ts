/**
 * Local draft protection.
 *
 * The Notes editor persists a small JSON blob in `localStorage` so that a
 * user's unsaved work survives:
 *   - page refresh
 *   - accidental navigation
 *   - browser / tab crash
 *   - temporary network loss
 *
 * Design rules:
 *   - NEVER store auth tokens, cookies, or secrets.
 *   - The draft is keyed deterministically per note id.
 *   - All operations are SSR-safe and storage-failure-safe.
 *   - The draft is a local convenience; the server revision is still the
 *     authoritative concurrency version.
 */

export type NoteDraft = {
  noteId: string;
  title: string;
  content: unknown;
  /** Server revision the draft was originally based on. */
  baseRevision: number;
  /** Local epoch ms when the draft was last updated. */
  updatedAt: number;
  /** Schema version, in case the draft format evolves. */
  version: 1;
};

export const NOTE_DRAFT_STORAGE_VERSION = 1 as const;

export function noteDraftKey(noteId: string): string {
  return `notes:draft:${noteId}`;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadDraft(noteId: string): NoteDraft | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(noteDraftKey(noteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isNoteDraft(parsed)) return null;
    if (parsed.noteId !== noteId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(draft: NoteDraft): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(noteDraftKey(draft.noteId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(noteId: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.removeItem(noteDraftKey(noteId));
    return true;
  } catch {
    return false;
  }
}

export function makeNoteDraft(args: {
  noteId: string;
  title: string;
  content: unknown;
  baseRevision: number;
}): NoteDraft {
  return {
    noteId: args.noteId,
    title: args.title,
    content: args.content,
    baseRevision: args.baseRevision,
    updatedAt: Date.now(),
    version: NOTE_DRAFT_STORAGE_VERSION,
  };
}

function isNoteDraft(v: unknown): v is NoteDraft {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["noteId"] === "string" &&
    typeof o["title"] === "string" &&
    typeof o["baseRevision"] === "number" &&
    typeof o["updatedAt"] === "number" &&
    o["version"] === 1
  );
}
