import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/auth-context";
import { errorToResponse } from "@/server/api/errors";
import { updateNoteBodySchema } from "@/server/validation/notes";
import {
  getAuthorizedNote,
  softDeleteNote,
  updateNote,
} from "@/server/services/notes-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(
  _req: NextRequest,
  ctx: Ctx,
): Promise<NextResponse> {
  try {
    const auth = await getAuthContext();
    const { id } = await ctx.params;
    const note = await getAuthorizedNote(id, auth.spaceId);
    if (!note) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Note not found" } },
        { status: 404 },
      );
    }
    return NextResponse.json({ note });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: Ctx,
): Promise<NextResponse> {
  try {
    const auth = await getAuthContext();
    const { id } = await ctx.params;
    const json = await req.json().catch(() => ({}));
    const input = updateNoteBodySchema.parse(json);
    const note = await updateNote(auth.userId, auth.spaceId, id, input);
    return NextResponse.json({ note });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: Ctx,
): Promise<NextResponse> {
  try {
    const auth = await getAuthContext();
    const { id } = await ctx.params;
    const result = await softDeleteNote(auth.userId, auth.spaceId, id);
    return NextResponse.json(result);
  } catch (err) {
    return errorToResponse(err);
  }
}
