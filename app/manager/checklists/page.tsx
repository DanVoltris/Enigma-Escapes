import ChecklistsBoard from "@/components/manager/ChecklistsBoard";
import { getChecklists, getTodayState } from "@/lib/checklists";
import { formatDateLong } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ChecklistsPage() {
  const [lists, state] = await Promise.all([getChecklists(), getTodayState()]);
  return (
    <>
      <h1 className="mgr-page-title">Checklists</h1>
      <p className="mgr-page-sub">
        Daily task lists for {formatDateLong(state.date)} — ticks reset automatically each day.
      </p>
      <ChecklistsBoard initialLists={lists} initialState={state} />
    </>
  );
}
