import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/auth-context";
import { errorToResponse } from "@/server/api/errors";
import {
  createNoteBodySchema,
} from "@/server/validation/notes";
import {
  createNote,
  listActiveNotes,
} from "@/server/services/notes-service";

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await getAuthContext();
    const notes = await listActiveNotes(auth.spaceId);
    return NextResponse.json({ notes });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await getAuthContext();
    const json = await req.json().catch(() => ({}));
    const input = createNoteBodySchema.parse(json);

    // The spaceId is always derived server-side from the authenticated
    // context. Any client-supplied spaceId is rejected by the strict
    // schema above.
    const note = await createNote(auth.userId, auth.spaceId, input);
    return NextResponse.json({ note }, { status: 201 });
  } catch (err) {
    return errorToResponse(err);
  }
}
