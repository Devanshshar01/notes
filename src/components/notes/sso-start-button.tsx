"use client";

import { useEffect, useState } from "react";

import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined" ? window.location.origin : undefined,
});

export function SsoStartButton({
  provider,
  label,
  nextPath = "/notes",
}: {
  provider: string;
  label: string;
  nextPath?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!error) return;
  }, [error]);

  async function start() {
    setError(null);
    setIsPending(true);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: `/auth/sso/finish?next=${encodeURIComponent(nextPath)}`,
      });
      if (result.error) {
        throw new Error(
          result.error.message ?? "Unable to start Our Space sign-in.",
        );
      }
      const redirectUrl =
        (
          result.data as { url?: string; redirect?: boolean } | null
        )?.url ?? null;
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }
      setIsPending(false);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong.",
      );
      setIsPending(false);
    }
  }

  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-surface-strong)] disabled:opacity-60"
      onClick={start}
      disabled={isPending}
      data-sso-provider={provider}
    >
      {isPending ? "Connecting to Our Space…" : label}
    </button>
  );
}