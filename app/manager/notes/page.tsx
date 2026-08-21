import BoardPage from "@/components/manager/BoardPage";
import NotesBoard from "@/components/manager/NotesBoard";
import { requirePermission } from "@/lib/auth";
import { listEditNotes } from "@/lib/edit-notes";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  await requirePermission("notes", "/manager/notes");
  const notes = await listEditNotes();
  return (
    <>
      <BoardPage />
      <h1 className="mgr-page-title">Notes</h1>
      <p className="mgr-page-sub">
        A shared board for you and your partner — leave notes about edits you want on the site, tick them off when
        they&apos;re handled. Not visible to customers.
      </p>
      <NotesBoard initialNotes={notes} />
    </>
  );
}
