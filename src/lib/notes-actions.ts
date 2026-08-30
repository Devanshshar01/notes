"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthContext } from "@/server/auth/auth-context";
import {
  createNote,
  getAuthorizedNote,
  softDeleteNote,
  updateNote,
} from "@/server/services/notes-service";
import {
  noteColorSchema,
  noteCategorySchema,
  noteDocumentSchema,
  MAX_NOTE_TITLE_BYTES,
} from "@/server/validation/notes";

const createInputSchema = z
  .object({
    title: z
      .string()
      .max(200)
      .refine(
        (s) => new TextEncoder().encode(s).byteLength <= MAX_NOTE_TITLE_BYTES,
        { message: "Title too large" },
      )
      .optional()
      .default(""),
    category: noteCategorySchema.optional(),
    color: noteColorSchema.optional(),
  })
  .strict();

const patchMetaInputSchema = z
  .object({
    noteId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    category: noteCategorySchema.optional(),
    color: noteColorSchema.optional(),
    isPinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.category !== undefined ||
      v.color !== undefined ||
      v.isPinned !== undefined ||
      v.archived !== undefined,
    { message: "At least one field besides revision must be provided" },
  );

const deleteInputSchema = z
  .object({ noteId: z.string().uuid() })
  .strict();

const saveContentInputSchema = z
  .object({
    noteId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    title: z
      .string()
      .max(200)
      .refine(
        (s) => new TextEncoder().encode(s).byteLength <= MAX_NOTE_TITLE_BYTES,
        { message: "Title too large" },
      ),
    content: noteDocumentSchema,
  })
  .strict();

export type ActionOk<T> = { ok: true; data: T };
export type ActionErr = {
  ok: false;
  error: { code: string; message: string; status: number };
};
export type ActionResult<T> = ActionOk<T> | ActionErr;

function toError(e: unknown): ActionErr["error"] {
  if (e && typeof e === "object" && "status" in e && "message" in e) {
    const err = e as { status: number; message: string; code?: string };
    return {
      code: err.code ?? defaultCodeForStatus(err.status),
      message: err.message,
      status: err.status,
    };
  }
  if (e instanceof z.ZodError) {
    return {
      code: "validation_error",
      message: "Invalid request",
      status: 422,
    };
  }
  return { code: "internal_error", message: "Something went wrong", status: 500 };
}

function defaultCodeForStatus(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  return "error";
}

function safeRevalidatePath(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // revalidatePath requires a Next.js request / static generation context.
    // In non-Next environments (tests, scripts) we silently skip cache invalidation.
  }
}

export async function createNoteAction(
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const input = createInputSchema.parse(raw);
    const auth = await getAuthContext();
    const note = await createNote(auth.userId, auth.spaceId, {
      title: input.title,
      category: input.category,
      color: input.color,
    });
    safeRevalidatePath("/notes");
    return { ok: true, data: { id: note.id } };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function patchNoteMetaAction(
  raw: unknown,
): Promise<ActionResult<{ revision: number; isPinned: boolean; category: string; color: string; archivedAt: string | null }>> {
  try {
    const input = patchMetaInputSchema.parse(raw);
    const { noteId, revision, ...patch } = input;
    const auth = await getAuthContext();
    const updated = await updateNote(auth.userId, auth.spaceId, noteId, {
      revision,
      ...patch,
    });
    safeRevalidatePath("/notes");
    safeRevalidatePath(`/notes/${noteId}`);
    return {
      ok: true,
      data: {
        revision: updated.revision,
        isPinned: updated.isPinned,
        category: updated.category,
        color: updated.color,
        archivedAt: updated.archivedAt,
      },
    };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function deleteNoteAction(
  raw: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { noteId } = deleteInputSchema.parse(raw);
    const auth = await getAuthContext();
    await softDeleteNote(auth.userId, auth.spaceId, noteId);
    safeRevalidatePath("/notes");
    return { ok: true, data: { id: noteId } };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export type SaveContentData = {
  id: string;
  revision: number;
  updatedAt: string;
};

export async function saveNoteContentAction(
  raw: unknown,
): Promise<ActionResult<SaveContentData>> {
  try {
    const input = saveContentInputSchema.parse(raw);
    const auth = await getAuthContext();
    const updated = await updateNote(auth.userId, auth.spaceId, input.noteId, {
      revision: input.revision,
      title: input.title,
      content: input.content,
    });
    safeRevalidatePath("/notes");
    safeRevalidatePath(`/notes/${input.noteId}`);
    return {
      ok: true,
      data: {
        id: updated.id,
        revision: updated.revision,
        updatedAt: updated.updatedAt,
      },
    };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function getNoteForReconcileAction(
  raw: unknown,
): Promise<ActionResult<SaveContentData & { title: string; content: unknown; category: string; color: string; isPinned: boolean }>> {
  try {
    const { noteId } = z.object({ noteId: z.string().uuid() }).strict().parse(raw);
    const auth = await getAuthContext();
    const note = await getAuthorizedNote(noteId, auth.spaceId);
    if (!note) {
      return {
        ok: false,
        error: { code: "not_found", message: "Note not found", status: 404 },
      };
    }
    return {
      ok: true,
      data: {
        id: note.id,
        revision: note.revision,
        updatedAt: note.updatedAt,
        title: note.title,
        content: note.content,
        category: note.category,
        color: note.color,
        isPinned: note.isPinned,
      },
    };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}
