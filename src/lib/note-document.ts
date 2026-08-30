import { z } from "zod";

const tiptapNode = z
  .object({
    type: z.string(),
  })
  .passthrough();

const tiptapDocument: z.ZodType<unknown> = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const noteDocumentJsonSchema = tiptapDocument;

export const DEFAULT_NOTE_DOCUMENT: unknown = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function coerceNoteDocument(
  content: unknown,
): { ok: true; doc: unknown } | { ok: false; reason: string } {
  const parsed = noteDocumentJsonSchema.safeParse(content);
  if (!parsed.success) {
    return { ok: false, reason: "shape" };
  }
  const node = tiptapNode.safeParse(content);
  if (!node.success) {
    return { ok: false, reason: "node" };
  }
  if (!Array.isArray((content as { content?: unknown }).content)) {
    return { ok: false, reason: "no-content" };
  }
  return { ok: true, doc: content };
}
