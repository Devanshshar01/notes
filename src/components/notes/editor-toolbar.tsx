"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";

export function EditorToolbar({ editor }: { editor: Editor | null }) {
  const [, force] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => force((n) => n + 1);
    editor.on("selectionUpdate", onUpdate);
    editor.on("transaction", onUpdate);
    return () => {
      editor.off("selectionUpdate", onUpdate);
      editor.off("transaction", onUpdate);
    };
  }, [editor]);

  if (!editor) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading editor toolbar"
        className="h-12 w-full rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)]"
      />
    );
  }

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex w-full items-center gap-1 overflow-x-auto rounded-soft border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ToolbarButton
        label="Bold"
        isActive={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        shortcut="B"
      >
        <span className="font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        isActive={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        shortcut="I"
      >
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        isActive={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        shortcut="U"
      >
        <span className="underline">U</span>
      </ToolbarButton>

      <Divider />

      <HeadingSelect editor={editor} />

      <Divider />

      <ToolbarButton
        label="Bulleted list"
        isActive={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListDots />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        isActive={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListNumbered />
      </ToolbarButton>
      <ToolbarButton
        label="Checklist"
        isActive={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <CheckboxIcon />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  label,
  isActive,
  onClick,
  shortcut,
  children,
}: {
  label: string;
  isActive: boolean;
  onClick(): void;
  shortcut?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={isActive}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={
        "inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-md px-2.5 text-sm transition active:scale-95 " +
        (isActive
          ? "bg-[var(--color-ink)] text-[var(--color-bg)]"
          : "text-[var(--color-ink-muted)] hover:bg-[var(--color-ink)]/5 hover:text-[var(--color-ink)]")
      }
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="mx-1 inline-block h-5 w-px shrink-0 bg-[var(--color-line)]"
    />
  );
}

function HeadingSelect({ editor }: { editor: Editor }) {
  const level = currentHeadingLevel(editor);
  return (
    <label className="relative shrink-0">
      <span className="sr-only">Paragraph style</span>
      <select
        value={String(level)}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (next === 0) {
            editor.chain().focus().setParagraph().run();
          } else {
            editor
              .chain()
              .focus()
              .toggleHeading({ level: next as 1 | 2 | 3 })
              .run();
          }
        }}
        className="h-9 appearance-none rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 pr-7 text-sm text-[var(--color-ink)]"
      >
        <option value="0">Paragraph</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[var(--color-ink-muted)]"
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </label>
  );
}

function currentHeadingLevel(editor: Editor): 0 | 1 | 2 | 3 {
  for (const lvl of [1, 2, 3] as const) {
    if (editor.isActive("heading", { level: lvl })) return lvl;
  }
  return 0;
}

function ListDots() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="4" cy="5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="15" r="0.9" fill="currentColor" stroke="none" />
      <path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round" />
    </svg>
  );
}

function ListNumbered() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 4h1v3M3 9h1l-1 1.5h1.5M3 14.5h1.5" strokeLinecap="round" />
      <path d="M8 5h9M8 10h9M8 15h9" strokeLinecap="round" />
    </svg>
  );
}

function CheckboxIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="4" width="4" height="4" rx="0.6" />
      <rect x="3" y="10" width="4" height="4" rx="0.6" />
      <path d="M10 6h8M10 12h8" strokeLinecap="round" />
    </svg>
  );
}
