export default function NoteLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading note"
      className="flex flex-col gap-5 rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
    >
      <div className="flex items-center justify-between">
        <div className="h-4 w-20 rounded-md bg-[var(--color-line)]/70" />
        <div className="h-4 w-24 rounded-md bg-[var(--color-line)]/70" />
      </div>
      <div className="h-7 w-3/4 rounded-md bg-[var(--color-line)]/70" />
      <div className="flex gap-2">
        <div className="h-6 w-16 rounded-full bg-[var(--color-line)]/50" />
        <div className="h-6 w-20 rounded-full bg-[var(--color-line)]/50" />
        <div className="h-6 w-20 rounded-full bg-[var(--color-line)]/50" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full rounded-md bg-[var(--color-line)]/40" />
        <div className="h-4 w-11/12 rounded-md bg-[var(--color-line)]/40" />
        <div className="h-4 w-2/3 rounded-md bg-[var(--color-line)]/40" />
      </div>
      <div className="h-10 w-full rounded-soft bg-[var(--color-line)]/40" />
    </div>
  );
}
