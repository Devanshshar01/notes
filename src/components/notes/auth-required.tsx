import Link from "next/link";

export function AuthRequired() {
  return (
    <section
      aria-labelledby="auth-required"
      className="flex flex-col items-center gap-4 rounded-soft border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-12 text-center"
    >
      <div
        aria-hidden="true"
        className="text-3xl"
        role="img"
        aria-label="Lock"
      >
        🔒
      </div>
      <div className="space-y-1">
        <h2
          id="auth-required"
          className="text-lg font-semibold tracking-tight"
        >
          Sign in to view your shared notes
        </h2>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Notes is part of Couple Space. Open the home screen to continue.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center justify-center rounded-soft bg-[var(--color-ink)] px-4 py-2.5 text-sm font-medium text-[var(--color-bg)] transition hover:opacity-90"
      >
        Back to Couple Space
      </Link>
    </section>
  );
}
