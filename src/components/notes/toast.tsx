"use client";

import { useEffect, useState } from "react";

export type Toast = {
  id: number;
  message: string;
  tone: "error" | "info";
};

let nextId = 1;

export function useToasts(): {
  toasts: Toast[];
  push(message: string, tone?: Toast["tone"]): void;
  dismiss(id: number): void;
} {
  const [toasts, setToasts] = useState<Toast[]>([]);

  function push(message: string, tone: Toast["tone"] = "info") {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, tone }]);
  }

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return { toasts, push, dismiss };
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss(id: number): void;
}) {
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      window.setTimeout(() => onDismiss(t.id), 3500),
    );
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)]"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={
            "pointer-events-auto max-w-sm rounded-soft border px-4 py-2.5 text-sm shadow-sm backdrop-blur " +
            (t.tone === "error"
              ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-100"
              : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)]")
          }
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
