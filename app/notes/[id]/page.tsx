import { notFound } from "next/navigation";
import { getAuthContext } from "@/server/auth/auth-context";
import { getAuthorizedNote } from "@/server/services/notes-service";
import { AuthRequired } from "@/components/notes/auth-required";
import { NoteEditor } from "@/components/notes/note-editor";

export const dynamic = "force-dynamic";

type Params = { id: string };

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;

  let auth: Awaited<ReturnType<typeof getAuthContext>>;
  try {
    auth = await getAuthContext();
  } catch {
    return <AuthRequired />;
  }

  const note = await getAuthorizedNote(id, auth.spaceId).catch(() => null);
  if (!note) notFound();

  return <NoteEditor note={note} currentUserId={auth.userId} />;
}
