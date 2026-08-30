import type { NoteDto } from "@/server/services/notes-service";
import { extractNoteSearchText } from "@/lib/note-preview";
import { categoryLabel } from "@/lib/note-meta";

export type NoteFilter = {
  search: string;
  category: string | null;
};

export function applyNoteFilter(
  notes: NoteDto[],
  filter: NoteFilter,
): NoteDto[] {
  const q = filter.search.trim().toLowerCase();
  const cat = filter.category;

  const filtered = notes.filter((n) => {
    if (cat && n.category !== cat) return false;
    if (!q) return true;
    if (n.title.toLowerCase().includes(q)) return true;
    if (categoryLabel(n.category).toLowerCase().includes(q)) return true;
    const body = extractNoteSearchText(n.content).toLowerCase();
    if (body.includes(q)) return true;
    return false;
  });

  return [...filtered].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

export function splitPinnedAndOthers(
  notes: NoteDto[],
): { pinned: NoteDto[]; others: NoteDto[] } {
  const pinned: NoteDto[] = [];
  const others: NoteDto[] = [];
  for (const n of notes) {
    if (n.isPinned) pinned.push(n);
    else others.push(n);
  }
  return { pinned, others };
}
