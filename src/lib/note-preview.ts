const MAX_PREVIEW = 160;

type DocNode = {
  type?: unknown;
  text?: unknown;
  content?: unknown;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readNodes(v: unknown): DocNode[] {
  if (!Array.isArray(v)) return [];
  const out: DocNode[] = [];
  for (const item of v) {
    if (isObject(item)) out.push(item as DocNode);
  }
  return out;
}

function visit(node: DocNode, parts: string[]): void {
  if (typeof node.text === "string") {
    parts.push(node.text);
    return;
  }
  const children = readNodes(node.content);
  for (const child of children) visit(child, parts);
}

export function extractNotePreview(content: unknown, max = MAX_PREVIEW): string {
  if (!isObject(content)) return "";
  const root = content as DocNode;
  const children = readNodes(root.content);
  const parts: string[] = [];
  for (const child of children) visit(child, parts);

  const text = parts
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

export function extractNoteSearchText(content: unknown): string {
  return extractNotePreview(content, 10_000);
}
