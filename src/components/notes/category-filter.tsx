"use client";

import { CATEGORY_OPTIONS, type NoteCategory } from "@/lib/note-meta";

type Props = {
  value: string | null;
  onChange(next: string | null): void;
};

export function CategoryFilter({ value, onChange }: Props) {
  return (
    <nav
      aria-label="Filter by category"
      className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex w-max items-center gap-2 sm:w-auto sm:flex-wrap">
        <li>
          <CategoryChip
            label="All"
            active={value === null}
            onClick={() => onChange(null)}
          />
        </li>
        {CATEGORY_OPTIONS.map((opt) => (
          <li key={opt.value}>
            <CategoryChip
              label={opt.label}
              active={value === opt.value}
              onClick={() => onChange(opt.value satisfies NoteCategory)}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full border px-3.5 py-1.5 text-sm transition " +
        (active
          ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-bg)]"
          : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]")
      }
    >
      {label}
    </button>
  );
}
