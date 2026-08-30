import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/server/auth/auth-context";
import { errorToResponse } from "@/server/api/errors";
import { listNoteChanges } from "@/server/services/notes-service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  cursor: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : new Date(0))),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

/**
 * Lightweight revalidation feed for the Notes dashboard.
 *
 * Returns metadata-only summaries of notes whose `updatedAt` is strictly
 * greater than the provided `cursor`. The response intentionally omits the
 * structured `content` so the payload stays small.
 *
 * Authenticated. `spaceId` is always derived server-side from the
 * authenticated context. The `cursor` is a client-supplied ISO datetime
 * and is treated as a read-only filter; the client cannot escalate its
 * authorization by choosing a different cursor.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await getAuthContext();
    const params = querySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    const summaries = await listNoteChanges(
      auth.spaceId,
      params.cursor,
      params.limit,
    );
    return NextResponse.json({
      summaries,
      /** Server time at the moment of the query; client uses as next cursor. */
      now: new Date().toISOString(),
    });
  } catch (err) {
    return errorToResponse(err);
  }
}
