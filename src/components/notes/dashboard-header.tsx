"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  search: string;
  onSearchChange(next: string): void;
  count: number;
  action?: ReactNode;
};

export function DashboardHeader({
  title,
  subtitle,
  search,
  onSearchChange,
  count,
  action,
}: Props) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:shrink-0">
        <p className="text-xs font-medium tracking-widest text-[var(--color-ink-muted)] uppercase">
          {title}
        </p>
        <h1
          id="notes-heading"
          className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          Shared notes
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          {subtitle ?? (count === 0
            ? "Start with something you both want to remember."
            : count === 1
              ? "1 note · a small notebook for the two of you"
              : `${count} notes · a small notebook for the two of you`)}
        </p>
      </div>

      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        <div className="w-full sm:max-w-sm sm:flex-1">
          <label htmlFor="notes-search" className="sr-only">
            Search notes
          </label>
          <div className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--color-ink-muted)]"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                className="h-4 w-4"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="9" cy="9" r="6" />
                <path d="m17 17-3.5-3.5" strokeLinecap="round" />
              </svg>
            </span>
            <input
              id="notes-search"
              type="search"
              inputMode="search"
              autoComplete="off"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search notes"
              className="w-full rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] py-2.5 pr-3 pl-9 text-sm placeholder:text-[var(--color-ink-muted)]/70"
            />
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}
