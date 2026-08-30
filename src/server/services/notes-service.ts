import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { HttpError, NoteConflictError } from "@/server/api/errors";
import { defaultDocument } from "@/server/validation/notes";
import {
  DEV_UI_SPACE_ID,
  DEV_UI_USER_ID,
  isDevUiMode,
  isDevUiSpace,
} from "@/server/dev/dev-ui";
import type {
  createNoteBodySchema,
  updateNoteBodySchema,
} from "@/server/validation/notes";
import type { z } from "zod";

export type NoteDto = {
  id: string;
  spaceId: string;
  title: string;
  content: unknown;
  isPinned: boolean;
  color: string;
  category: string;
  createdBy: string;
  updatedBy: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
};

function toDto(row: schema.NoteRow): NoteDto {
  return {
    id: row.id,
    spaceId: row.spaceId,
    title: row.title,
    content: row.content,
    isPinned: row.isPinned,
    color: row.color,
    category: row.category,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function syntheticDevUiNote(noteId: string): NoteDto {
  const now = new Date().toISOString();
  return {
    id: noteId,
    spaceId: DEV_UI_SPACE_ID,
    title: "",
    content: defaultDocument(),
    isPinned: false,
    color: "none",
    category: "general",
    createdBy: DEV_UI_USER_ID,
    updatedBy: DEV_UI_USER_ID,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
  };
}

/**
 * In-memory state for synthetic dev-UI notes. Only used when
 * `NOTES_DEV_UI=true` and the authorized spaceId is the synthetic
 * "dev-ui" space. The notes are never persisted; they exist so the
 * dashboard, editor, and autosave flows can be inspected locally without
 * a real Couple Space session.
 *
 * This is intentionally process-local: it is NOT a substitute for the
 * PostgreSQL-backed note store. It does not survive a server restart,
 * is not shared across processes, and is disabled in production.
 */
type DevUiNoteState = {
  dto: NoteDto;
  deleted: boolean;
};
const devUiNotes = new Map<string, DevUiNoteState>();

function cloneDefaultDocument(): unknown {
  return defaultDocument();
}

function freshDevUiNote(input?: {
  title?: string;
  color?: string;
  category?: string;
  isPinned?: boolean;
  content?: unknown;
}): NoteDto {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    spaceId: DEV_UI_SPACE_ID,
    title: input?.title ?? "",
    content: input?.content ?? cloneDefaultDocument(),
    isPinned: input?.isPinned ?? false,
    color: input?.color ?? "none",
    category: input?.category ?? "general",
    createdBy: DEV_UI_USER_ID,
    updatedBy: DEV_UI_USER_ID,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
  };
}

/**
 * Test-only: clear the in-memory dev-UI note map. Exported under a
 * `__test` alias so production callers don't see it. Intended for the
 * dev-UI bypass test file's beforeEach.
 */
export const __devUiNotesForTests = {
  clear(): void {
    devUiNotes.clear();
  },
  size(): number {
    return devUiNotes.size;
  },
};

export async function listActiveNotes(spaceId: string): Promise<NoteDto[]> {
  if (isDevUiMode() && spaceId === DEV_UI_SPACE_ID) {
    return [];
  }
  const rows = await db
    .select()
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.spaceId, spaceId),
        isNull(schema.notes.deletedAt),
        isNull(schema.notes.archivedAt),
      ),
    )
    .orderBy(desc(schema.notes.isPinned), desc(schema.notes.updatedAt));
  return rows.map(toDto);
}

export async function getAuthorizedNote(
  noteId: string,
  spaceId: string,
): Promise<NoteDto | null> {
  // Dev-only fast path: for the synthetic dev-ui space, we never touch the
  // DB. `space_id` is a UUID column and "dev-ui" is not a valid UUID.
  if (isDevUiSpace(spaceId)) {
    if (!isUuid(noteId)) return null;
    const state = devUiNotes.get(noteId);
    if (state) return state.deleted ? null : state.dto;
    return syntheticDevUiNote(noteId);
  }

  const rows = await db
    .select()
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.id, noteId),
        eq(schema.notes.spaceId, spaceId),
        isNull(schema.notes.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row) return toDto(row);
  return null;
}

export type CreateNoteInput = z.infer<typeof createNoteBodySchema>;

export async function createNote(
  userId: string,
  spaceId: string,
  input: CreateNoteInput,
): Promise<NoteDto> {
  if (isDevUiSpace(spaceId)) {
    const note = freshDevUiNote(input);
    devUiNotes.set(note.id, { dto: note, deleted: false });
    return note;
  }
  const inserted = await db
    .insert(schema.notes)
    .values({
      spaceId,
      title: input.title ?? "",
      content: input.content ?? defaultDocument(),
      color: input.color ?? "none",
      category: input.category ?? "general",
      isPinned: input.isPinned ?? false,
      createdBy: userId,
      updatedBy: userId,
      revision: 1,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new HttpError(500, "insert_failed", "Failed to create note");
  return toDto(row);
}

export type UpdateNoteInput = z.infer<typeof updateNoteBodySchema>;

export async function updateNote(
  userId: string,
  spaceId: string,
  noteId: string,
  input: UpdateNoteInput,
): Promise<NoteDto> {
  if (isDevUiSpace(spaceId)) {
    if (!isUuid(noteId)) throw new HttpError(404, "not_found", "Note not found");
    const existing = devUiNotes.get(noteId);
    const base =
      existing && !existing.deleted
        ? existing.dto
        : syntheticDevUiNote(noteId);
    if (input.revision !== base.revision) {
      throw NoteConflictError(base.revision, input.revision);
    }
    const next: NoteDto = {
      ...base,
      title: input.title !== undefined ? input.title : base.title,
      content: input.content !== undefined ? input.content : base.content,
      color: input.color !== undefined ? input.color : base.color,
      category: input.category !== undefined ? input.category : base.category,
      isPinned: input.isPinned !== undefined ? input.isPinned : base.isPinned,
      archivedAt:
        input.archived !== undefined
          ? input.archived
            ? new Date().toISOString()
            : null
          : base.archivedAt,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
      revision: base.revision + 1,
    };
    devUiNotes.set(noteId, { dto: next, deleted: false });
    return next;
  }

  const patch: Partial<schema.NoteInsert> = {
    updatedBy: userId,
  };
  if (input.title !== undefined) patch.title = input.title;
  if (input.content !== undefined) patch.content = input.content;
  if (input.color !== undefined) patch.color = input.color;
  if (input.category !== undefined) patch.category = input.category;
  if (input.isPinned !== undefined) patch.isPinned = input.isPinned;
  if (input.archived !== undefined) {
    patch.archivedAt = input.archived ? new Date() : null;
  }

  const result = await db
    .update(schema.notes)
    .set({
      ...patch,
      updatedAt: new Date(),
      revision: sql`${schema.notes.revision} + 1`,
    })
    .where(
      and(
        eq(schema.notes.id, noteId),
        eq(schema.notes.spaceId, spaceId),
        isNull(schema.notes.deletedAt),
        eq(schema.notes.revision, input.revision),
      ),
    )
    .returning();

  if (result.length === 0) {
    const current = await getAuthorizedNote(noteId, spaceId);
    if (!current) throw new HttpError(404, "not_found", "Note not found");
    throw NoteConflictError(current.revision, input.revision);
  }

  return toDto(result[0]!);
}

export async function softDeleteNote(
  userId: string,
  spaceId: string,
  noteId: string,
): Promise<{ id: string; deletedAt: string }> {
  if (isDevUiSpace(spaceId)) {
    if (!isUuid(noteId)) throw new HttpError(404, "not_found", "Note not found");
    const existing = devUiNotes.get(noteId);
    if (existing && existing.deleted) {
      return { id: noteId, deletedAt: existing.dto.deletedAt! };
    }
    const base =
      existing && !existing.deleted
        ? existing.dto
        : syntheticDevUiNote(noteId);
    const deletedAt = new Date().toISOString();
    const next: NoteDto = {
      ...base,
      deletedAt,
      updatedBy: userId,
      updatedAt: deletedAt,
    };
    devUiNotes.set(noteId, { dto: next, deleted: true });
    return { id: noteId, deletedAt };
  }

  const result = await db
    .update(schema.notes)
    .set({
      deletedAt: new Date(),
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.notes.id, noteId),
        eq(schema.notes.spaceId, spaceId),
        isNull(schema.notes.deletedAt),
      ),
    )
    .returning({ id: schema.notes.id, deletedAt: schema.notes.deletedAt });

  const row = result[0];
  if (!row) {
    const existing = await getAuthorizedNote(noteId, spaceId);
    if (!existing) throw new HttpError(404, "not_found", "Note not found");
    return { id: existing.id, deletedAt: existing.deletedAt! };
  }
  return { id: row.id, deletedAt: row.deletedAt!.toISOString() };
}

/**
 * Metadata-only view of a note for lightweight revalidation polling.
 * Excludes the structured content body to keep the payload small.
 */
export type NoteSummary = {
  id: string;
  title: string;
  isPinned: boolean;
  color: string;
  category: string;
  updatedBy: string;
  revision: number;
  updatedAt: string;
};

/**
 * Return active notes whose `updatedAt` is strictly greater than `cursor`.
 * Used by the dashboard's lightweight revalidation poll.
 *
 * Authenticated. `spaceId` is the authorized Couple Space from the session.
 * The response carries only metadata (no `content`) so the payload stays
 * small even for a busy Couple Space.
 */
export async function listNoteChanges(
  spaceId: string,
  cursor: Date,
  limit = 100,
): Promise<NoteSummary[]> {
  if (isDevUiMode() && spaceId === DEV_UI_SPACE_ID) {
    return [];
  }
  const rows = await db
    .select({
      id: schema.notes.id,
      title: schema.notes.title,
      isPinned: schema.notes.isPinned,
      color: schema.notes.color,
      category: schema.notes.category,
      updatedBy: schema.notes.updatedBy,
      revision: schema.notes.revision,
      updatedAt: schema.notes.updatedAt,
    })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.spaceId, spaceId),
        isNull(schema.notes.deletedAt),
        isNull(schema.notes.archivedAt),
        sql`${schema.notes.updatedAt} > ${cursor.toISOString()}`,
      ),
    )
    .orderBy(sql`${schema.notes.updatedAt} ASC`)
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    isPinned: r.isPinned,
    color: r.color,
    category: r.category,
    updatedBy: r.updatedBy,
    revision: r.revision,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Metadata-only fetch of a single note. Used by the open-note revalidation
 * poll to detect a newer server revision without transferring the full
 * TipTap document.
 */
export async function getNoteSummary(
  noteId: string,
  spaceId: string,
): Promise<NoteSummary | null> {
  if (isDevUiSpace(spaceId)) {
    if (!isUuid(noteId)) return null;
    const state = devUiNotes.get(noteId);
    if (state && !state.deleted) {
      const d = state.dto;
      return {
        id: d.id,
        title: d.title,
        isPinned: d.isPinned,
        color: d.color,
        category: d.category,
        updatedBy: d.updatedBy,
        revision: d.revision,
        updatedAt: d.updatedAt,
      };
    }
    return {
      id: noteId,
      title: "",
      isPinned: false,
      color: "none",
      category: "general",
      updatedBy: DEV_UI_USER_ID,
      revision: 1,
      updatedAt: new Date().toISOString(),
    };
  }
  const rows = await db
    .select({
      id: schema.notes.id,
      title: schema.notes.title,
      isPinned: schema.notes.isPinned,
      color: schema.notes.color,
      category: schema.notes.category,
      updatedBy: schema.notes.updatedBy,
      revision: schema.notes.revision,
      updatedAt: schema.notes.updatedAt,
    })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.id, noteId),
        eq(schema.notes.spaceId, spaceId),
        isNull(schema.notes.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    isPinned: row.isPinned,
    color: row.color,
    category: row.category,
    updatedBy: row.updatedBy,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}
