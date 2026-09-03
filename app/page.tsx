import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/server/auth/auth";
import { SsoStartButton } from "@/components/notes/sso-start-button";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });

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
        aria-label="Sign in"
        className="rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
      >
        <h2 className="text-base font-semibold">Sign in</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Notes is part of Couple Space. Continue with Our Space to access your
          shared notebook.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          {session ? (
            <Link
              href="/notes"
              className="inline-flex items-center justify-center rounded-soft bg-[var(--color-ink)] px-4 py-2.5 text-sm font-medium text-[var(--color-bg)] transition hover:opacity-90"
            >
              Continue to your notes
            </Link>
          ) : (
            <SsoStartButton provider="our-space" label="Continue with Our Space" />
          )}
          <Link
            href="/notes"
            className="inline-flex items-center justify-center text-xs text-[var(--color-ink-muted)] underline-offset-2 hover:underline"
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