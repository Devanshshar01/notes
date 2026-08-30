import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notes",
  description: "Your shared notes with your partner.",
};

export default function NotesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1180px] flex-col px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <nav aria-label="Primary" className="mb-5 sm:mb-6">
        <Link
          href="/"
          className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          ← Couple Space
        </Link>
      </nav>
      <div className="flex-1">{children}</div>
    </div>
  );
}
