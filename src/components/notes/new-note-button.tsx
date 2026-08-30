"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createNoteAction } from "@/lib/notes-actions";
import { callAction } from "@/lib/action-result";
import type { NoteColor, NoteCategory } from "@/lib/note-meta";

type Props = {
  defaultCategory?: NoteCategory;
  defaultColor?: NoteColor;
  onError(message: string): void;
  onStart?(): void;
};

export function NewNoteButton({
  defaultCategory = "general",
  defaultColor = "none",
  onError,
  onStart,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    onStart?.();
    startTransition(async () => {
      const result = await callAction(
        () =>
          createNoteAction({
            category: defaultCategory,
            color: defaultColor,
          }),
        onError,
        "Couldn't create the note. Try again.",
      );
      if (!result || !result.ok) return;
      router.push(`/notes/${result.data.id}`);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label="New note"
      className="inline-flex items-center gap-2 rounded-soft bg-[var(--color-ink)] px-4 py-2.5 text-sm font-medium text-[var(--color-bg)] shadow-sm transition hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        className="h-4 w-4"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M10 4v12M4 10h12" strokeLinecap="round" />
      </svg>
      {isPending ? "Creating…" : "New note"}
    </button>
  );
}
