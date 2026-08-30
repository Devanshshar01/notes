"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CATEGORY_OPTIONS,
  COLOR_OPTIONS,
  categoryLabel,
  colorMeta,
  type NoteCategory,
  type NoteColor,
} from "@/lib/note-meta";
import { attributionAuthor, formatAttribution } from "@/lib/note-attribution";
import { extractNotePreview } from "@/lib/note-preview";
import { formatRelativeTime } from "@/lib/relative-time";
import { callAction } from "@/lib/action-result";
import { deleteNoteAction, patchNoteMetaAction } from "@/lib/notes-actions";

type NoteLike = {
  id: string;
  title: string;
  content: unknown;
  isPinned: boolean;
  color: string;
  category: string;
  updatedAt: string;
  updatedBy: string;
  revision: number;
};

type Props = {
  note: NoteLike;
  currentUserId: string;
  onChange(updated: {
    id: string;
    revision: number;
    isPinned: boolean;
    category: string;
    color: string;
  }): void;
  onRemove(id: string): void;
  onError(message: string): void;
};

export function NoteCard({
  note,
  currentUserId,
  onChange,
  onRemove,
  onError,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [openMenu, setOpenMenu] = useState<null | "category" | "color" | "more">(
    null,
  );

  const preview = note.title ? "" : extractNotePreview(note.content);
  const meta = colorMeta(note.color);
  const attribution = formatAttribution({
    author: attributionAuthor(note.updatedBy, currentUserId),
    when: formatRelativeTime(note.updatedAt),
  });

  function applyPatch(
    patch: Partial<Pick<NoteLike, "isPinned" | "category" | "color">>,
  ) {
    const prev = {
      isPinned: note.isPinned,
      category: note.category,
      color: note.color,
    };
    const optimistic = { ...prev, ...patch };
    onChange({
      id: note.id,
      revision: note.revision,
      isPinned: optimistic.isPinned,
      category: optimistic.category,
      color: optimistic.color,
    });

    startTransition(async () => {
      const result = await callAction(
        () =>
          patchNoteMetaAction({
            noteId: note.id,
            revision: note.revision,
            ...patch,
          }),
        (msg) => {
          onChange({
            id: note.id,
            revision: note.revision,
            isPinned: prev.isPinned,
            category: prev.category,
            color: prev.color,
          });
          onError(msg);
        },
        "Couldn't update the note",
      );
      if (!result || !result.ok) return;
      onChange({
        id: note.id,
        revision: result.data.revision,
        isPinned: result.data.isPinned,
        category: result.data.category,
        color: result.data.color,
      });
    });
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 3500);
      return;
    }
    onRemove(note.id);
    startTransition(async () => {
      const result = await callAction(
        () => deleteNoteAction({ noteId: note.id }),
        (msg) => {
          onError(msg);
          router.refresh();
        },
        "Couldn't remove the note. Try again.",
      );
      // Failure path is handled by `onError` inside callAction.
      void result;
    });
  }

  return (
    <article
      aria-label={note.title || "Untitled note"}
      className={
        "group relative flex flex-col gap-3 overflow-hidden rounded-soft border p-4 transition " +
        "hover:shadow-sm focus-within:shadow-sm " +
        meta.swatch +
        " " +
        meta.accent
      }
    >
      {note.isPinned ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-amber-500/70 dark:bg-amber-400/70"
        />
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/notes/${note.id}`}
          className="min-w-0 flex-1 text-base font-semibold tracking-tight break-words hover:underline"
        >
          {note.title || (
            <span className="text-[var(--color-ink-muted)] italic">Untitled</span>
          )}
        </Link>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => applyPatch({ isPinned: !note.isPinned })}
            disabled={isPending}
            aria-label={note.isPinned ? "Unpin note" : "Pin note"}
            aria-pressed={note.isPinned}
            className={
              "inline-flex h-8 w-8 items-center justify-center rounded-full transition active:scale-95 " +
              (note.isPinned
                ? "text-amber-600 dark:text-amber-400"
                : "text-[var(--color-ink-muted)] opacity-50 hover:opacity-100")
            }
          >
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill={note.isPinned ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M9.5 2.5v4l-2.5 1.5 1 1.5L9 10.5v6l1.5 1 1.5-1v-6l1-1 1-1.5L11 6.5v-4z" strokeLinejoin="round" />
            </svg>
          </button>
          <MoreMenu
            isOpen={openMenu === "more"}
            onOpenChange={(v) => setOpenMenu(v ? "more" : null)}
            onDelete={handleDelete}
            confirmingDelete={confirmingDelete}
            onCancelDelete={() => setConfirmingDelete(false)}
          />
        </div>
      </div>

      {preview ? (
        <p className="line-clamp-3 text-sm leading-relaxed text-[var(--color-ink-muted)]">
          {preview}
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <MenuButton
          label={categoryLabel(note.category)}
          ariaLabel="Change category"
          isOpen={openMenu === "category"}
          onOpenChange={(v) => setOpenMenu(v ? "category" : null)}
          options={CATEGORY_OPTIONS.map((opt) => ({
            key: opt.value,
            label: opt.label,
            onSelect: () =>
              applyPatch({ category: opt.value satisfies NoteCategory }),
            current: opt.value === note.category,
          }))}
        />
        <ColorSwatchMenu
          current={note.color}
          isOpen={openMenu === "color"}
          onOpenChange={(v) => setOpenMenu(v ? "color" : null)}
          onSelect={(v) => applyPatch({ color: v satisfies NoteColor })}
        />
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-[var(--color-ink-muted)]">
        <span className="min-w-0 truncate" title={attribution}>
          {note.isPinned ? (
            <span className="text-amber-700 dark:text-amber-400">Pinned · </span>
          ) : null}
          {attribution}
        </span>
      </div>
    </article>
  );
}

function MenuButton<T extends string>({
  label,
  ariaLabel,
  isOpen,
  onOpenChange,
  options,
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
  }>;
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
        {label}
        <svg
          viewBox="0 0 12 12"
          className="h-3 w-3 opacity-60"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {isOpen ? (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          className="absolute top-full left-0 z-10 mt-1.5 max-h-64 w-44 overflow-auto rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-md"
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
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ColorSwatchMenu({
  current,
  isOpen,
  onOpenChange,
  onSelect,
}: {
  current: string;
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  onSelect(value: NoteColor): void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Change color"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)]/70 transition hover:border-[var(--color-ink-muted)]"
      >
        <span
          aria-hidden="true"
          className={
            "block h-3 w-3 rounded-full border border-[var(--color-line)] " +
            (colorMeta(current).swatch)
          }
        />
      </button>
      {isOpen ? (
        <ul
          role="listbox"
          aria-label="Change color"
          className="absolute top-full right-0 z-10 mt-1.5 flex w-auto gap-1 rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-md"
        >
          {COLOR_OPTIONS.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                role="option"
                aria-selected={opt.value === current}
                aria-label={opt.label}
                onClick={() => {
                  onSelect(opt.value);
                  onOpenChange(false);
                }}
                className={
                  "block h-6 w-6 rounded-full border " +
                  (opt.value === current
                    ? "border-[var(--color-ink)] ring-2 ring-[var(--color-ink)]/30"
                    : "border-[var(--color-line)] hover:border-[var(--color-ink-muted)]") +
                  " " +
                  opt.swatch
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MoreMenu({
  isOpen,
  onOpenChange,
  onDelete,
  confirmingDelete,
  onCancelDelete,
}: {
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  onDelete(): void;
  confirmingDelete: boolean;
  onCancelDelete(): void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!isOpen)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-ink-muted)] opacity-50 transition hover:opacity-100"
      >
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="5" cy="10" r="1.4" />
          <circle cx="10" cy="10" r="1.4" />
          <circle cx="15" cy="10" r="1.4" />
        </svg>
      </button>
      {isOpen ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-20 mt-1.5 w-44 rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-md"
        >
          {confirmingDelete ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDelete();
                  onOpenChange(false);
                }}
                className="flex w-full items-center rounded-md bg-rose-600 px-2.5 py-1.5 text-left text-sm font-medium text-white transition hover:bg-rose-700"
              >
                Tap again to remove
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCancelDelete();
                  onOpenChange(false);
                }}
                className="mt-1 flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm text-[var(--color-ink-muted)] transition hover:bg-[var(--color-ink)]/5 hover:text-[var(--color-ink)]"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDelete();
              }}
              className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm text-[var(--color-ink-muted)] transition hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
            >
              Remove
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

