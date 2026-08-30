import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-10">
      <header className="mb-10">
        <p className="text-sm font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
          Couple Space
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Shared Notes
        </h1>
        <p className="mt-3 text-[var(--color-ink-muted)]">
          A small, private notebook for the two of you.
        </p>
      </header>

      <section
        aria-label="Foundation status"
        className="rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
      >
        <h2 className="text-base font-semibold">Foundation ready</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          The application shell is in place. Notes, accounts, and storage will
          be added in upcoming steps.
        </p>
        <div className="mt-5">
          <Link
            href="/notes"
            className="inline-flex items-center justify-center rounded-soft bg-[var(--color-ink)] px-4 py-2.5 text-sm font-medium text-[var(--color-bg)] transition hover:opacity-90"
          >
            Open notes
          </Link>
        </div>
      </section>

      <footer className="mt-12 text-xs text-[var(--color-ink-muted)]">
        <p>Shared Notes · part of Couple Space.</p>
      </footer>
    </main>
  );
}
