"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CategoryFilter } from "@/components/notes/category-filter";
import { DashboardHeader } from "@/components/notes/dashboard-header";
import { NewNoteButton } from "@/components/notes/new-note-button";
import { NoteCard } from "@/components/notes/note-card";
import { ToastStack, useToasts } from "@/components/notes/toast";
import { applyNoteFilter, splitPinnedAndOthers } from "@/lib/note-filter";
import {
  DEFAULT_DASHBOARD_INTERVAL_MS,
  useChangesPolling,
} from "@/lib/use-changes-polling";
import type {
  NoteDto,
  NoteSummary,
} from "@/server/services/notes-service";

type Props = {
  initialNotes: NoteDto[];
  currentUserId: string;
};

type CardNote = {
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

function toCard(n: NoteDto): CardNote {
  return {
    id: n.id,
    title: n.title,
    content: n.content,
    isPinned: n.isPinned,
    color: n.color,
    category: n.category,
    updatedAt: n.updatedAt,
    updatedBy: n.updatedBy,
    revision: n.revision,
  };
}

function toCardFromSummary(s: NoteSummary): CardNote {
  return {
    id: s.id,
    title: s.title,
    content: undefined,
    isPinned: s.isPinned,
    color: s.color,
    category: s.category,
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
    revision: s.revision,
  };
}

async function fetchChanges(
  cursor: string,
  signal: AbortSignal,
): Promise<{ summaries: NoteSummary[]; now: string }> {
  const res = await fetch(
    `/api/notes/changes?cursor=${encodeURIComponent(cursor)}`,
    { signal, credentials: "same-origin" },
  );
  if (!res.ok) throw new Error(`changes ${res.status}`);
  return (await res.json()) as { summaries: NoteSummary[]; now: string };
}

export function NotesDashboard({ initialNotes, currentUserId }: Props) {
  const [notes, setNotes] = useState<CardNote[]>(() =>
    initialNotes.map(toCard),
  );
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const toasts = useToasts();
  const cursorRef = useRef<string>(
    initialNotes.reduce(
      (acc, n) => (n.updatedAt > acc ? n.updatedAt : acc),
      "1970-01-01T00:00:00.000Z",
    ),
  );
  const notesRef = useRef<CardNote[]>(notes);
  notesRef.current = notes;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  const handleChange = useCallback(
    (updated: {
      id: string;
      revision: number;
      isPinned: boolean;
      category: string;
      color: string;
    }) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === updated.id
            ? {
                ...n,
                revision: updated.revision,
                isPinned: updated.isPinned,
                category: updated.category,
                color: updated.color,
                updatedAt: new Date().toISOString(),
              }
            : n,
        ),
      );
    },
    [],
  );

  const handleRemove = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleError = useCallback(
    (message: string) => {
      toasts.push(message, "error");
    },
    [toasts],
  );

  // Lightweight revalidation: poll /api/notes/changes and merge updated
  // metadata into the local notes list. Does not change search / category
  // / scroll state.
  useChangesPolling(
    (signal) => fetchChanges(cursorRef.current, signal),
    {
      onSuccess: ({ summaries, now }) => {
        if (summaries.length === 0) return;
        // Merge: for each summary, if it's newer than the local copy,
        // update the local entry; if we don't have it locally at all
        // (e.g. partner created a new note), keep it out of the list
        // until the next full refresh — the dashboard is not a
        // create-feed; this avoids surprise insertions mid-scroll.
        setNotes((prev) => {
          const byId = new Map(prev.map((n) => [n.id, n] as const));
          for (const s of summaries) {
            const existing = byId.get(s.id);
            if (!existing) continue;
            if (existing.revision >= s.revision) continue;
            byId.set(s.id, toCardFromSummary(s));
          }
          // Preserve order: pinned first, then by updatedAt desc.
          return Array.from(byId.values()).sort((a, b) => {
            if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
            return a.updatedAt < b.updatedAt ? 1 : -1;
          });
        });
        cursorRef.current = now;
      },
      onError: () => {
        // Silent: backoff is handled inside the polling hook.
      },
    },
    { enabled: true, intervalMs: DEFAULT_DASHBOARD_INTERVAL_MS },
  );

  const filtered = useMemo(
    () =>
      applyNoteFilter(notes as unknown as NoteDto[], {
        search,
        category,
      }),
    [notes, search, category],
  );

  const { pinned, others } = useMemo(
    () =>
      splitPinnedAndOthers(filtered as unknown as NoteDto[]),
    [filtered],
  );

  const totalActive = notes.length;
  const hasAnyNotes = totalActive > 0;
  const hasResults = filtered.length > 0;
  const showPinnedHeader = pinned.length > 0;
  const showOthersHeader =
    others.length > 0 && (hasAnyNotes || search.length > 0 || category !== null);

  return (
    <div className="flex flex-col gap-5 pb-28 sm:gap-6">
      <DashboardHeader
        title="Our notes"
        search={search}
        onSearchChange={setSearch}
        count={totalActive}
        action={<NewNoteButton onError={handleError} />}
      />

      <CategoryFilter value={category} onChange={setCategory} />

      {!hasAnyNotes ? (
        <EmptyState onError={handleError} />
      ) : !hasResults ? (
        <NoResultsState
          search={search}
          category={category}
          onClear={() => {
            setSearch("");
            setCategory(null);
          }}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {showPinnedHeader ? (
            <Section
              title="Pinned"
              notes={pinned}
              currentUserId={currentUserId}
              onChange={handleChange}
              onRemove={handleRemove}
              onError={handleError}
            />
          ) : null}
          {showOthersHeader ? (
            <Section
              title={showPinnedHeader ? "Recent" : undefined}
              notes={others}
              currentUserId={currentUserId}
              onChange={handleChange}
              onRemove={handleRemove}
              onError={handleError}
            />
          ) : null}
        </div>
      )}

      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  );
}

type CardChange = {
  id: string;
  revision: number;
  isPinned: boolean;
  category: string;
  color: string;
};

function Section({
  title,
  notes,
  currentUserId,
  onChange,
  onRemove,
  onError,
}: {
  title?: string;
  notes: NoteDto[];
  currentUserId: string;
  onChange(updated: CardChange): void;
  onRemove(id: string): void;
  onError(message: string): void;
}) {
  return (
    <section aria-label={title ?? "Notes"} className="flex flex-col gap-3">
      {title ? (
        <h2 className="text-xs font-semibold tracking-widest text-[var(--color-ink-muted)] uppercase">
          {title}
        </h2>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {notes.map((n) => (
          <NoteCard
            key={n.id}
            note={{
              id: n.id,
              title: n.title,
              content: n.content,
              isPinned: n.isPinned,
              color: n.color,
              category: n.category,
              updatedAt: n.updatedAt,
              updatedBy: n.updatedBy,
              revision: n.revision,
            }}
            currentUserId={currentUserId}
            onChange={onChange}
            onRemove={onRemove}
            onError={onError}
          />
        ))}
      </div>
    </section>
  );
}

function EmptyState({ onError }: { onError(message: string): void }) {
  return (
    <section
      aria-label="Empty notes"
      className="flex flex-col items-start gap-5 rounded-soft border border-dashed border-[var(--color-line)] bg-[var(--color-surface)]/60 px-5 py-10 sm:flex-row sm:items-center sm:gap-6 sm:px-7 sm:py-10"
    >
      <span
        aria-hidden="true"
        className="shrink-0 text-3xl sm:text-4xl"
        role="img"
        aria-label="Notebook"
      >
        📝
      </span>
      <div className="flex-1 space-y-1 sm:max-w-xl">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          Your shared notebook is empty
        </h2>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Save something small you both want to remember — a plan, a thought, a
          list, or a moment worth keeping.
        </p>
      </div>
      <div className="self-stretch sm:self-auto">
        <NewNoteButton onError={onError} />
      </div>
    </section>
  );
}

function NoResultsState({
  search,
  category,
  onClear,
}: {
  search: string;
  category: string | null;
  onClear(): void;
}) {
  const reason = search.trim()
    ? `No notes match “${search.trim()}”${category ? ` in ${category}` : ""}.`
    : category
      ? `No notes in ${category} yet.`
      : "Nothing here yet.";
  return (
    <section
      aria-label="No results"
      className="flex flex-col items-start gap-3 rounded-soft border border-dashed border-[var(--color-line)] bg-[var(--color-surface)]/60 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-7"
    >
      <h2 className="text-base font-semibold tracking-tight sm:text-lg">
        {reason}
      </h2>
      <button
        type="button"
        onClick={onClear}
        className="self-start rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-1.5 text-sm text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)] sm:self-auto"
      >
        Clear filters
      </button>
    </section>
  );
}
