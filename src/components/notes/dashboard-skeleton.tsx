export function DashboardSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading notes"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="h-3 w-20 rounded-full bg-[var(--color-line)]/70" />
          <div className="mt-2 h-7 w-40 rounded-md bg-[var(--color-line)]/70" />
          <div className="mt-2 h-4 w-24 rounded-md bg-[var(--color-line)]/50" />
        </div>
        <div className="h-10 w-32 rounded-soft bg-[var(--color-line)]/70" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-20 rounded-full bg-[var(--color-line)]/50"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-36 animate-pulse rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)]"
          />
        ))}
      </div>
    </div>
  );
}
