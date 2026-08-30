import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/auth-context";
import { errorToResponse } from "@/server/api/errors";
import { getNoteSummary } from "@/server/services/notes-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Lightweight single-note metadata fetch for the open-note revalidation
 * poll. Excludes the structured `content` body so the open editor can
 * detect a newer server revision without repeatedly transferring the
 * full TipTap document.
 *
 * Returns 404 if the note does not exist or the caller is not authorized
 * to see it. The 404 is intentionally indistinguishable from a missing
 * note so the existence of notes in other Couple Spaces is not leaked.
 */
export async function GET(
  _req: NextRequest,
  ctx: Ctx,
): Promise<NextResponse> {
  try {
    const auth = await getAuthContext();
    const { id } = await ctx.params;
    const summary = await getNoteSummary(id, auth.spaceId);
    if (!summary) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Note not found" } },
        { status: 404 },
      );
    }
    return NextResponse.json({ summary });
  } catch (err) {
    return errorToResponse(err);
  }
}
