"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_RETRY_DELAYS_MS,
  NoteAutosave,
  type SaveResult,
  type SaveSnapshot,
} from "@/lib/note-autosave";
import { saveNoteContentAction } from "@/lib/notes-actions";

async function callServerSave(args: {
  noteId: string;
  revision: number;
  title: string;
  content: unknown;
}): Promise<SaveResult> {
  const result = await saveNoteContentAction(args);
  if (result.ok) {
    return {
      ok: true,
      revision: result.data.revision,
      updatedAt: result.data.updatedAt,
    };
  }
  return {
    ok: false,
    error: {
      kind: "server",
      status: result.error.status,
      code: result.error.code,
      message: result.error.message,
    },
  };
}

export type UseNoteAutosaveArgs = {
  noteId: string;
  initialRevision: number;
  initialUpdatedAt: string;
  initialTitle: string;
  initialContent: unknown;
};

export type UseNoteAutosave = {
  controller: NoteAutosave;
  snapshot: SaveSnapshot;
  /** Mark the editor's local state as dirty. */
  markDirty(next: { title?: string; content?: unknown }): void;
  /** Force a flush (page hide, manual). */
  flush(): void;
  /** Called by the UI when the server snapshot changes externally. */
  noteServerSnapshot(snap: {
    revision: number;
    updatedAt: string;
    title: string;
    content: unknown;
  }): void;
  /**
   * Called by the UI after a metadata-only update (pin / category / color)
   * so the controller's confirmed revision is bumped without overwriting the
   * last-saved document state.
   */
  noteMetaOnlyUpdated(snap: { revision: number; updatedAt: string }): void;
  /** Report a manual conflict (e.g. UI-initiated reconcile). */
  enterConflict(snap: {
    revision: number;
    updatedAt: string;
    title: string;
    content: unknown;
  }): void;
  /** User chose to retry the local draft. */
  retryWithCurrentLocal(): void;
  /** User chose to adopt the server snapshot. */
  discardLocalForServer(snap: {
    title: string;
    content: unknown;
    revision: number;
    updatedAt: string;
  }): void;
  /** True when the local editor has unsaved edits. */
  isDirty(): boolean;
  /** Apply a server-authoritative document update (clean editor path). */
  applyRemoteUpdate(snap: {
    title: string;
    content: unknown;
    revision: number;
    updatedAt: string;
  }): void;
};

export function useNoteAutosave(args: UseNoteAutosaveArgs): UseNoteAutosave {
  const controllerRef = useRef<NoteAutosave | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new NoteAutosave({
      noteId: args.noteId,
      initialRevision: args.initialRevision,
      initialUpdatedAt: args.initialUpdatedAt,
      initialTitle: args.initialTitle,
      initialContent: args.initialContent,
      save: callServerSave,
    });
  }
  const controller = controllerRef.current;

  const [snapshot, setSnapshot] = useState<SaveSnapshot>(() =>
    controller.snapshot(),
  );

  useEffect(() => {
    controller.start();
    const unsub = controller.subscribe(setSnapshot);
    return () => {
      unsub();
      controller.stop();
    };
  }, [controller]);

  // Browser lifecycle: retry on online, flush on pagehide, draft on
  // visibilitychange.
  useEffect(() => {
    function onOnline() {
      controller.onNetworkOnline();
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        // The local draft is already persisted on every keystroke. We
        // attempt a best-effort flush but never block the unload.
        try {
          controller.flush();
        } catch {
          // ignore — flush is best-effort during hidden
        }
      }
    }
    function onPageHide() {
      try {
        controller.flush();
      } catch {
        // ignore
      }
    }
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [controller]);

  return useMemo<UseNoteAutosave>(
    () => ({
      controller,
      snapshot,
      markDirty: (next) => controller.markDirty(next),
      flush: () => controller.flush(),
      noteServerSnapshot: (snap) => controller.noteServerSnapshot(snap),
      noteMetaOnlyUpdated: (snap) => controller.noteMetaOnlyUpdated(snap),
      enterConflict: (snap) => controller.enterConflict(snap),
      retryWithCurrentLocal: () => controller.retryWithCurrentLocal(),
      discardLocalForServer: (snap) => controller.discardLocalForServer(snap),
      isDirty: () => controller.isDirty(),
      applyRemoteUpdate: (snap) => controller.applyRemoteUpdate(snap),
    }),
    [controller, snapshot],
  );
}

export { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_RETRY_DELAYS_MS };
