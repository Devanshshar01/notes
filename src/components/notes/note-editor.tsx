"use client";

import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { EditorToolbar } from "@/components/notes/editor-toolbar";
import { ToastStack, useToasts } from "@/components/notes/toast";
import {
  CATEGORY_OPTIONS,
  COLOR_OPTIONS,
  categoryLabel,
  colorMeta,
  type NoteCategory,
  type NoteColor,
} from "@/lib/note-meta";
import {
  coerceNoteDocument,
  DEFAULT_NOTE_DOCUMENT,
} from "@/lib/note-document";
import {
  deleteNoteAction,
  getNoteForReconcileAction,
  patchNoteMetaAction,
} from "@/lib/notes-actions";
import { useNoteAutosave } from "@/lib/use-note-autosave";
import {
  DEFAULT_OPEN_NOTE_INTERVAL_MS,
  useChangesPolling,
} from "@/lib/use-changes-polling";
import { formatRelativeTime } from "@/lib/relative-time";
import { attributionAuthor, formatAttribution } from "@/lib/note-attribution";
import { callAction } from "@/lib/action-result";
import type {
  NoteDto,
  NoteSummary,
} from "@/server/services/notes-service";

type Props = {
  note: NoteDto;
  currentUserId: string;
};

export function NoteEditor({ note, currentUserId }: Props) {
  const router = useRouter();
  const toasts = useToasts();
  const [, startTransition] = useTransition();
  const [isPinned, setIsPinned] = useState(note.isPinned);
  const [category, setCategory] = useState(note.category);
  const [color, setColor] = useState(note.color);
  const [openMenu, setOpenMenu] = useState<null | "category" | "color">(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [conflictServer, setConflictServer] = useState<{
    title: string;
    content: unknown;
    category: string;
    color: string;
    isPinned: boolean;
    revision: number;
    updatedAt: string;
  } | null>(null);
  const [draftRecovered, setDraftRecovered] = useState(false);

  const initialDoc = coerceNoteDocument(note.content);
  const initialContent: JSONContent = initialDoc.ok
    ? (initialDoc.doc as JSONContent)
    : (DEFAULT_NOTE_DOCUMENT as JSONContent);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: false }),
      Placeholder.configure({
        placeholder: "Start writing…",
        showOnlyWhenEditable: true,
      }),
    ],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose-notes min-h-[40vh] max-w-none whitespace-pre-wrap break-words " +
          "text-[15px] leading-relaxed focus:outline-none",
      },
    },
  });

  // The controlled title value is kept locally in this component; the
  // autosave hook is the source of truth for persistence.
  const [title, setTitle] = useState(note.title);

  const autosave = useNoteAutosave({
    noteId: note.id,
    initialRevision: note.revision,
    initialUpdatedAt: note.updatedAt,
    initialTitle: note.title,
    initialContent: note.content,
  });

  // Apply recovered draft on mount, before the user starts typing.
  useEffect(() => {
    if (draftRecovered) return;
    const draft = autosave.controller.recoverDraft(note.revision);
    if (draft) {
      setTitle(draft.title);
      if (editor) {
        const coerced = coerceNoteDocument(draft.content);
        editor.commands.setContent(
          (coerced.ok ? coerced.doc : DEFAULT_NOTE_DOCUMENT) as JSONContent,
          false,
        );
      }
      toasts.push("Restored your unsaved changes from this device.", "info");
    }
    setDraftRecovered(true);
    // Intentionally only run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRecovered]);

  // Wire the editor's onUpdate to the autosave controller. The handler
  // reference is kept in a ref so we bind the editor's listener exactly
  // once for the editor's lifetime, instead of re-binding on every
  // snapshot update.
  const markDirtyRef = useRef(autosave.markDirty);
  markDirtyRef.current = autosave.markDirty;
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      markDirtyRef.current({ content: editor.getJSON() });
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor]);

  // When the autosave snapshot reports a conflict, fetch the latest
  // authoritative server snapshot so the UI can offer recovery.
  useEffect(() => {
    if (autosave.snapshot.state !== "conflict") {
      setConflictServer(null);
      return;
    }
    if (conflictServer) return;
    let cancelled = false;
    (async () => {
      const result = await getNoteForReconcileAction({ noteId: note.id });
      if (cancelled || !result.ok) return;
      setConflictServer({
        title: result.data.title,
        content: result.data.content,
        category: result.data.category,
        color: result.data.color,
        isPinned: result.data.isPinned,
        revision: result.data.revision,
        updatedAt: result.data.updatedAt,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [autosave.snapshot.state, autosave.snapshot.confirmedRevision, note.id, conflictServer]);

  // ── Lightweight revalidation: poll the note summary every ~2.5s while
  // the page is visible. When the server has a newer revision:
  //   - if the local editor is clean, silently adopt the server document;
  //   - if the local editor is dirty (unsaved local edits), show a calm
  //     "Your partner updated this note" notice with [View latest] /
  //     [Keep editing] buttons so we never silently destroy unsaved work.
  // The current user's own updates are filtered out via the
  // `lastSelfRevision` marker.
  const [lastSelfRevision, setLastSelfRevision] = useState<number>(note.revision);
  const [lastAppliedRemoteRevision, setLastAppliedRemoteRevision] =
    useState<number>(note.revision);
  const [partnerUpdate, setPartnerUpdate] = useState<{
    revision: number;
    updatedBy: string;
    updatedAt: string;
  } | null>(null);

  const isAdoptingRef = useRef(false);

  async function adoptRemoteUpdate(): Promise<void> {
    if (isAdoptingRef.current) return;
    isAdoptingRef.current = true;
    try {
      const res = await fetch(
        `/api/notes/${encodeURIComponent(note.id)}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) {
        toasts.push("Couldn't load the latest version.", "error");
        return;
      }
      const data = (await res.json()) as { note: NoteDto };
      const fresh = data.note;
      const coerced = coerceNoteDocument(fresh.content);
      const content = (coerced.ok ? coerced.doc : DEFAULT_NOTE_DOCUMENT) as JSONContent;
      autosave.applyRemoteUpdate({
        title: fresh.title,
        content,
        revision: fresh.revision,
        updatedAt: fresh.updatedAt,
      });
      setTitle(fresh.title);
      if (editor) {
        editor.commands.setContent(content, false);
      }
      setLastAppliedRemoteRevision(fresh.revision);
      setLastSelfRevision(fresh.revision);
      setIsPinned(fresh.isPinned);
      setCategory(fresh.category);
      setColor(fresh.color);
      setPartnerUpdate(null);
    } finally {
      isAdoptingRef.current = false;
    }
  }

  useChangesPolling<NoteSummary | null>(
    async (signal) => {
      const res = await fetch(
        `/api/notes/${encodeURIComponent(note.id)}/summary`,
        { signal, credentials: "same-origin" },
      );
      if (!res.ok) {
        if (res.status === 404) {
          // The note was deleted (or revoked). The dashboard will reflect
          // this on its own next poll; we just stop applying changes here.
          return null;
        }
        throw new Error(`summary ${res.status}`);
      }
      const data = (await res.json()) as { summary: NoteSummary };
      return data.summary;
    },
    {
      onSuccess: (summary) => {
        if (!summary) return;
        const incoming = summary;
        if (incoming.revision <= lastAppliedRemoteRevision) return;
        if (incoming.revision <= lastSelfRevision) return;
        // Self-update guard: if the incoming updatedBy is the current
        // user, this is the result of our own save or a meta update.
        // Ignore — we already have this state locally.
        if (incoming.updatedBy === currentUserId) {
          setLastSelfRevision((prev) => Math.max(prev, incoming.revision));
          setLastAppliedRemoteRevision((prev) => Math.max(prev, incoming.revision));
          return;
        }
        if (autosave.isDirty()) {
          // Preserve the user's unsaved work. Show a notice.
          setPartnerUpdate({
            revision: incoming.revision,
            updatedBy: incoming.updatedBy,
            updatedAt: incoming.updatedAt,
          });
          return;
        }
        // Clean editor — adopt the partner's update silently.
        void adoptRemoteUpdate();
      },
      onError: () => {
        // Silent: backoff is handled by the polling hook.
      },
    },
    { enabled: true, intervalMs: DEFAULT_OPEN_NOTE_INTERVAL_MS },
  );

  const applyMeta = useCallback(
    (patch: Partial<{ isPinned: boolean; category: string; color: string }>) => {
      const prev = {
        isPinned,
        category,
        color,
      };
      const optimistic = { ...prev, ...patch };
      setIsPinned(optimistic.isPinned);
      setCategory(optimistic.category);
      setColor(optimistic.color);
      startTransition(async () => {
        const result = await callAction(
          () =>
            patchNoteMetaAction({
              noteId: note.id,
              revision: autosave.snapshot.confirmedRevision,
              ...patch,
            }),
          (msg) => {
            setIsPinned(prev.isPinned);
            setCategory(prev.category);
            setColor(prev.color);
            toasts.push(msg, "error");
          },
          "Couldn't update the note. Try again.",
        );
        if (!result || !result.ok) return;
        autosave.noteMetaOnlyUpdated({
          revision: result.data.revision,
          updatedAt: autosave.snapshot.serverUpdatedAt,
        });
      });
    },
    [
      autosave,
      category,
      color,
      isPinned,
      note.id,
      startTransition,
      toasts,
    ],
  );

  const onDelete = useCallback(() => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 3500);
      return;
    }
    startTransition(async () => {
      const result = await callAction(
        () => deleteNoteAction({ noteId: note.id }),
        (msg) => {
          toasts.push(msg, "error");
        },
        "Couldn't remove the note. Try again.",
      );
      if (!result || !result.ok) return;
      router.push("/notes");
    });
  }, [confirmingDelete, note.id, router, startTransition, toasts]);

  const meta = colorMeta(color);
  const status = autosave.snapshot.state;
  const statusText = statusTextFor(status, autosave.snapshot.serverUpdatedAt);

  return (
    <article
      className={
        "flex flex-col gap-5 rounded-soft border p-4 sm:p-6 " +
        meta.swatch +
        " " +
        meta.accent
      }
    >
      <NoteHeader
        backHref="/notes"
        title={title}
        onTitleChange={(next) => {
          setTitle(next);
          autosave.markDirty({ title: next });
        }}
        isPinned={isPinned}
        category={category}
        color={color}
        onTogglePin={() => applyMeta({ isPinned: !isPinned })}
        onChangeCategory={(v) => applyMeta({ category: v })}
        onChangeColor={(v) => applyMeta({ color: v })}
        onDelete={onDelete}
        confirmingDelete={confirmingDelete}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        saveLabel={statusText.label}
        saveTone={statusText.tone}
        attribution={formatAttribution({
          author: attributionAuthor(
            note.updatedBy,
            currentUserId,
          ),
          when: formatRelativeTime(autosave.snapshot.serverUpdatedAt),
        })}
        currentRevision={autosave.snapshot.confirmedRevision}
      />

      <div
        className="rounded-soft bg-[var(--color-surface)]/80 p-4 sm:p-5"
        onClick={(e) => {
          const t = e.target as HTMLElement | null;
          if (t && t.closest("[data-toolbar]")) return;
          if (
            t &&
            t.tagName !== "INPUT" &&
            t.tagName !== "TEXTAREA" &&
            t.closest("[contenteditable='true']") === null &&
            editor
          ) {
            editor.commands.focus("end");
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>

      <div
        data-toolbar
        className="sticky bottom-[max(env(safe-area-inset-bottom),0.5rem)] z-10 -mx-1 px-1 pb-1"
      >
        <EditorToolbar editor={editor} />
      </div>

      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />

      {partnerUpdate ? (
        <PartnerUpdateNotice
          updatedAt={partnerUpdate.updatedAt}
          onViewLatest={() => {
            void adoptRemoteUpdate();
          }}
          onDismiss={() => {
            // "Keep editing" — just dismiss the notice. The user's
            // unsaved local edits are still in the autosave controller
            // and in localStorage. We do NOT mark lastAppliedRemote,
            // so the next time the editor is clean, the partner's
            // version will be re-evaluated.
            setPartnerUpdate(null);
            setLastAppliedRemoteRevision(partnerUpdate.revision);
          }}
        />
      ) : null}

      {autosave.snapshot.state === "conflict" && conflictServer ? (
        <ConflictDialog
          incoming={conflictServer}
          localTitle={title}
          localHasChanges={autosave.snapshot.hasDraft || status === "conflict"}
          onKeepMine={() => {
            // Tell the controller the new base revision and flush.
            autosave.controller.enterConflict({
              revision: conflictServer.revision,
              updatedAt: conflictServer.updatedAt,
              title: conflictServer.title,
              content: conflictServer.content,
            });
            autosave.retryWithCurrentLocal();
            setConflictServer(null);
          }}
          onUseLatest={() => {
            setTitle(conflictServer.title);
            setIsPinned(conflictServer.isPinned);
            setCategory(conflictServer.category);
            setColor(conflictServer.color);
            if (editor) {
              const coerced = coerceNoteDocument(conflictServer.content);
              editor.commands.setContent(
                (coerced.ok ? coerced.doc : DEFAULT_NOTE_DOCUMENT) as JSONContent,
                false,
              );
            }
            autosave.discardLocalForServer({
              title: conflictServer.title,
              content: conflictServer.content,
              revision: conflictServer.revision,
              updatedAt: conflictServer.updatedAt,
            });
            setConflictServer(null);
          }}
        />
      ) : null}
    </article>
  );
}

function NoteHeader({
  backHref,
  title,
  onTitleChange,
  isPinned,
  category,
  color,
  onTogglePin,
  onChangeCategory,
  onChangeColor,
  onDelete,
  confirmingDelete,
  openMenu,
  setOpenMenu,
  saveLabel,
  saveTone,
  attribution,
  currentRevision,
}: {
  backHref: string;
  title: string;
  onTitleChange(next: string): void;
  isPinned: boolean;
  category: string;
  color: string;
  onTogglePin(): void;
  onChangeCategory(next: NoteCategory): void;
  onChangeColor(next: NoteColor): void;
  onDelete(): void;
  confirmingDelete: boolean;
  openMenu: null | "category" | "color";
  setOpenMenu(next: null | "category" | "color"): void;
  saveLabel: string;
  saveTone: "ok" | "warn" | "neutral" | "danger" | "info";
  attribution: string;
  currentRevision: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={backHref}
          className="text-sm text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
        >
          ← All notes
        </Link>
        <SaveStatusPill label={saveLabel} tone={saveTone} />
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled"
        aria-label="Note title"
        maxLength={200}
        className="w-full bg-transparent text-2xl font-semibold tracking-tight break-words outline-none placeholder:text-[var(--color-ink-muted)]/60 sm:text-3xl"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={isPinned ? "Unpin note" : "Pin note"}
          aria-pressed={isPinned}
          className={
            "inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)]/70 px-2.5 py-1 text-xs transition " +
            (isPinned
              ? "text-amber-600 dark:text-amber-400"
              : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]")
          }
        >
          <svg
            viewBox="0 0 20 20"
            className="h-3.5 w-3.5"
            fill={isPinned ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M9.5 2.5v4l-2.5 1.5 1 1.5L9 10.5v6l1.5 1 1.5-1v-6l1-1 1-1.5L11 6.5v-4z" strokeLinejoin="round" />
          </svg>
          {isPinned ? "Pinned" : "Pin"}
        </button>

        <MetaMenu
          label={categoryLabel(category)}
          ariaLabel="Change category"
          isOpen={openMenu === "category"}
          onOpenChange={(v) => setOpenMenu(v ? "category" : null)}
          options={CATEGORY_OPTIONS.map((opt) => ({
            key: opt.value,
            label: opt.label,
            onSelect: () => onChangeCategory(opt.value),
            current: opt.value === category,
          }))}
        />

        <MetaMenu
          label={colorMeta(color).label}
          ariaLabel="Change color"
          tone="swatch"
          isOpen={openMenu === "color"}
          onOpenChange={(v) => setOpenMenu(v ? "color" : null)}
          options={COLOR_OPTIONS.map((opt) => ({
            key: opt.value,
            label: opt.label,
            onSelect: () => onChangeColor(opt.value),
            current: opt.value === color,
            swatch: opt.swatch,
          }))}
        />

        <button
          type="button"
          onClick={onDelete}
          aria-label={confirmingDelete ? "Confirm remove note" : "Remove note"}
          className={
            "ml-auto inline-flex items-center rounded-full border border-transparent px-2.5 py-1 text-xs transition " +
            (confirmingDelete
              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
              : "text-[var(--color-ink-muted)] opacity-60 hover:opacity-100")
          }
        >
          {confirmingDelete ? "Tap again to remove" : "Remove"}
        </button>
      </div>

      <p className="text-xs text-[var(--color-ink-muted)]">
        {attribution} · Revision {currentRevision}
      </p>
    </div>
  );
}

function SaveStatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "neutral" | "danger" | "info";
}) {
  const toneClass = {
    ok: "text-emerald-700 dark:text-emerald-400",
    warn: "text-amber-700 dark:text-amber-400",
    neutral: "text-[var(--color-ink-muted)]",
    danger: "text-rose-700 dark:text-rose-400",
    info: "text-sky-700 dark:text-sky-400",
  }[tone];
  const dotClass = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    neutral: "bg-[var(--color-ink-muted)]",
    danger: "bg-rose-500",
    info: "bg-sky-500",
  }[tone];
  return (
    <span
      role="status"
      aria-live="polite"
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs " + toneClass
      }
    >
      <span
        aria-hidden="true"
        className={"inline-block h-1.5 w-1.5 rounded-full " + dotClass}
      />
      {label}
    </span>
  );
}

function statusTextFor(
  state:
    | "saved"
    | "dirty"
    | "saving"
    | "offline"
    | "error"
    | "auth_error"
    | "conflict",
  serverUpdatedAt: string,
): { label: string; tone: "ok" | "warn" | "neutral" | "danger" | "info" } {
  switch (state) {
    case "saving":
      return { label: "Saving…", tone: "info" };
    case "dirty":
      return { label: "Saving soon…", tone: "neutral" };
    case "offline":
      return { label: "Offline — saved locally", tone: "warn" };
    case "error":
      return { label: "Couldn't save — retrying", tone: "danger" };
    case "auth_error":
      return { label: "Sign in to keep saving", tone: "danger" };
    case "conflict":
      return { label: "Newer version found", tone: "warn" };
    case "saved":
    default:
      return {
        label: `Saved · ${formatRelativeTime(serverUpdatedAt)}`,
        tone: "ok",
      };
  }
}

function MetaMenu<T extends string>({
  label,
  ariaLabel,
  isOpen,
  onOpenChange,
  options,
  tone,
}: {
  label: string;
  ariaLabel: string;
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  options: ReadonlyArray<{
    key: T;
    label: string;
    onSelect(): void;
    current: boolean;
    swatch?: string;
  }>;
  tone?: "swatch";
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)]/70 px-2.5 py-1 text-xs text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
      >
        {tone === "swatch" ? (
          <span
            aria-hidden="true"
            className={
              "inline-block h-2.5 w-2.5 rounded-full border border-[var(--color-line)] " +
              (options.find((o) => o.current)?.swatch ?? "")
            }
          />
        ) : null}
        {label}
      </button>
      {isOpen ? (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          className="absolute top-full left-0 z-20 mt-1.5 max-h-64 w-44 overflow-auto rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-md"
        >
          {options.map((opt) => (
            <li key={opt.key}>
              <button
                type="button"
                role="option"
                aria-selected={opt.current}
                onClick={() => {
                  opt.onSelect();
                  onOpenChange(false);
                }}
                className={
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition " +
                  (opt.current
                    ? "bg-[var(--color-ink)]/5 text-[var(--color-ink)]"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-ink)]/5 hover:text-[var(--color-ink)]")
                }
              >
                {opt.swatch ? (
                  <span
                    aria-hidden="true"
                    className={
                      "inline-block h-3 w-3 rounded-full border border-[var(--color-line)] " +
                      opt.swatch
                    }
                  />
                ) : null}
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PartnerUpdateNotice({
  updatedAt,
  onViewLatest,
  onDismiss,
}: {
  updatedAt: string;
  onViewLatest(): void;
  onDismiss(): void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-start gap-3 rounded-soft border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/40 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    >
      <p className="text-[var(--color-ink)]">
        Your partner updated this note
        <span className="ml-1 text-[var(--color-ink-muted)]">
          ({formatRelativeTime(updatedAt)})
        </span>
        .
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full px-3 py-1.5 text-sm text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]"
        >
          Keep editing
        </button>
        <button
          type="button"
          onClick={onViewLatest}
          className="rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-sm font-medium text-[var(--color-bg)] transition hover:opacity-90"
        >
          View latest
        </button>
      </div>
    </div>
  );
}

function ConflictDialog({
  incoming,
  localTitle,
  onKeepMine,
  onUseLatest,
}: {
  incoming: { title: string; content: unknown; revision: number };
  localTitle: string;
  localHasChanges: boolean;
  onKeepMine(): void;
  onUseLatest(): void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-md rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-lg">
        <h2
          id="conflict-title"
          className="text-base font-semibold tracking-tight"
        >
          Newer version found
        </h2>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Your unsaved changes (
          <span className="font-medium text-[var(--color-ink)]">
            “{localTitle || "Untitled"}”
          </span>
          ) are based on an older revision than what is on the server. The
          latest version is{" "}
          <span className="font-medium text-[var(--color-ink)]">
            “{incoming.title || "Untitled"}”
          </span>{" "}
          (revision {incoming.revision}).
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[var(--color-ink-muted)]">
          <li>
            <span className="font-medium text-[var(--color-ink)]">
              Keep mine
            </span>{" "}
            saves your changes over the server version.
          </li>
          <li>
            <span className="font-medium text-[var(--color-ink)]">
              Use latest
            </span>{" "}
            discards your unsaved changes and opens the server version.
          </li>
        </ul>
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
          Your unsaved work is still safe in this device&apos;s local draft either
          way.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onUseLatest}
            className="inline-flex items-center justify-center rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2 text-sm font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-ink)]/5"
          >
            Use latest
          </button>
          <button
            type="button"
            onClick={onKeepMine}
            className="inline-flex items-center justify-center rounded-soft bg-[var(--color-ink)] px-3.5 py-2 text-sm font-medium text-[var(--color-bg)] transition hover:opacity-90"
          >
            Keep mine
          </button>
        </div>
      </div>
    </div>
  );
}
