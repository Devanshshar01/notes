/**
 * Attribution strings for note metadata.
 *
 * The product philosophy is to use neutral, mature wording:
 *   "You" / "Your partner"
 *
 * Real names / avatars are NOT fetched. The dev identity tables do not
 * store names, and the central Couple Space profile system is a future
 * step. This helper deliberately avoids revealing any UUID-shaped data.
 */

export type AttributedAuthor = "you" | "partner";

export function attributionAuthor(
  updatedBy: string | null | undefined,
  currentUserId: string,
): AttributedAuthor {
  if (updatedBy && currentUserId && updatedBy === currentUserId) return "you";
  return "partner";
}

export type Attribution =
  | { kind: "you" }
  | { kind: "partner" };

/**
 * Build the compact attribution string shown under a note card or in the
 * editor header.
 *
 * Examples:
 *   formatAttribution({ author: "you", when: "5m ago" })
 *     => "Edited by you · 5m ago"
 *   formatAttribution({ author: "partner", when: "3h ago" })
 *     => "Edited by your partner · 3h ago"
 *
 * The verb "Edited" matches the existing dashboard copy. If the product
 * later tracks a "created vs edited" distinction this helper is the seam.
 */
export function formatAttribution(opts: {
  author: AttributedAuthor;
  when: string;
}): string {
  const who = opts.author === "you" ? "you" : "your partner";
  const when = opts.when.trim();
  if (!when) return `Last edited by ${who}`;
  return `Edited by ${who} · ${when}`;
}
