import { z } from "zod";
import {
  DEFAULT_DOCUMENT,
  noteCategories,
  noteColors,
} from "@/server/db/schema";

/**
 * Maximum JSON-serialized byte size for a note document. This is a generous
 * cap that accommodates very long notes with many checklist items while
 * preventing a single request from exhausting the database or the JSON
 * parser. ~256 KB serialized.
 */
export const MAX_NOTE_DOCUMENT_BYTES = 256 * 1024;

/**
 * Maximum serialized byte size for a note title. The schema also caps the
 * string at 200 characters; this is a defense-in-depth cap in case the
 * character-count check is ever bypassed.
 */
export const MAX_NOTE_TITLE_BYTES = 4 * 1024;

function jsonByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const paragraphBlock = z
  .object({
    type: z.literal("paragraph"),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough();

const documentRoot = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough();

const tiptapDocument: z.ZodType<unknown> = z.lazy(() =>
  z.union([documentRoot, paragraphBlock]),
);

export const noteDocumentSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough()
  .refine(
    (v) => jsonByteLength(v) <= MAX_NOTE_DOCUMENT_BYTES,
    { message: `Note content exceeds the ${MAX_NOTE_DOCUMENT_BYTES}-byte limit` },
  );

export const noteCategorySchema = z.enum(noteCategories);
export const noteColorSchema = z.enum(noteColors);

export const createNoteBodySchema = z
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
    content: noteDocumentSchema.optional(),
    color: noteColorSchema.optional(),
    category: noteCategorySchema.optional(),
    isPinned: z.boolean().optional(),
  })
  .strict();

export const updateNoteBodySchema = z
  .object({
    title: z
      .string()
      .max(200)
      .refine(
        (s) => new TextEncoder().encode(s).byteLength <= MAX_NOTE_TITLE_BYTES,
        { message: "Title too large" },
      )
      .optional(),
    content: noteDocumentSchema.optional(),
    color: noteColorSchema.optional(),
    category: noteCategorySchema.optional(),
    isPinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, {
    message: "At least one field besides revision must be provided",
  });

export const defaultDocument = (): unknown => structuredClone(DEFAULT_DOCUMENT);
export { tiptapDocument };
