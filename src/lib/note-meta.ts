import { noteCategories, noteColors } from "@/server/db/schema";

export type NoteCategory = (typeof noteCategories)[number];
export type NoteColor = (typeof noteColors)[number];

export const CATEGORY_OPTIONS: ReadonlyArray<{
  value: NoteCategory;
  label: string;
}> = [
  { value: "general", label: "General" },
  { value: "ideas", label: "Ideas" },
  { value: "lists", label: "Lists" },
  { value: "letters", label: "Letters" },
  { value: "plans", label: "Plans" },
  { value: "memories", label: "Memories" },
  { value: "travel", label: "Travel" },
];

const CATEGORY_LABEL: Record<NoteCategory, string> = CATEGORY_OPTIONS.reduce(
  (acc, opt) => {
    acc[opt.value] = opt.label;
    return acc;
  },
  {} as Record<NoteCategory, string>,
);

export function categoryLabel(value: string): string {
  return (CATEGORY_LABEL as Record<string, string>)[value] ?? "General";
}

export const COLOR_OPTIONS: ReadonlyArray<{
  value: NoteColor;
  label: string;
  swatch: string;
  accent: string;
  ring: string;
}> = [
  { value: "none", label: "Default", swatch: "bg-[var(--color-surface)]", accent: "border-[var(--color-line)]", ring: "ring-[var(--color-line)]" },
  { value: "warm", label: "Warm", swatch: "bg-amber-100 dark:bg-amber-950/40", accent: "border-amber-200/80 dark:border-amber-900/60", ring: "ring-amber-300/60" },
  { value: "cool", label: "Cool", swatch: "bg-sky-100 dark:bg-sky-950/40", accent: "border-sky-200/80 dark:border-sky-900/60", ring: "ring-sky-300/60" },
  { value: "rose", label: "Rose", swatch: "bg-rose-100 dark:bg-rose-950/40", accent: "border-rose-200/80 dark:border-rose-900/60", ring: "ring-rose-300/60" },
  { value: "sage", label: "Sage", swatch: "bg-emerald-100 dark:bg-emerald-950/40", accent: "border-emerald-200/80 dark:border-emerald-900/60", ring: "ring-emerald-300/60" },
  { value: "sand", label: "Sand", swatch: "bg-stone-200 dark:bg-stone-800/60", accent: "border-stone-300 dark:border-stone-700", ring: "ring-stone-300/60" },
];

const COLOR_BY_VALUE: Record<string, (typeof COLOR_OPTIONS)[number]> =
  COLOR_OPTIONS.reduce(
    (acc, opt) => {
      acc[opt.value] = opt;
      return acc;
    },
    {} as Record<string, (typeof COLOR_OPTIONS)[number]>,
  );

export function colorMeta(
  value: string,
): (typeof COLOR_OPTIONS)[number] {
  return COLOR_BY_VALUE[value] ?? COLOR_OPTIONS[0]!;
}
