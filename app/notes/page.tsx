import { NotesDashboard } from "@/components/notes/notes-dashboard";
import { AuthRequired } from "@/components/notes/auth-required";
import { getAuthContext } from "@/server/auth/auth-context";
import { listActiveNotes } from "@/server/services/notes-service";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  let auth: Awaited<ReturnType<typeof getAuthContext>>;
  try {
    auth = await getAuthContext();
  } catch {
    return <AuthRequired />;
  }

  let notes: Awaited<ReturnType<typeof listActiveNotes>>;
  try {
    notes = await listActiveNotes(auth.spaceId);
  } catch {
    notes = [];
  }

  return (
    <NotesDashboard
      initialNotes={notes}
      currentUserId={auth.userId}
    />
  );
}
