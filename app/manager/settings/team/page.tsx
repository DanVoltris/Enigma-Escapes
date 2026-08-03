import TeamManager from "@/components/manager/TeamManager";
import { requirePermission } from "@/lib/auth";
import { listAllLocations } from "@/lib/hours";
import { listStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const me = await requirePermission("staff", "/manager/settings/team");
  const [staff, locations] = await Promise.all([listStaff(), listAllLocations()]);
  return (
    <div className="mgr-card">
      <h2>Team &amp; permissions</h2>
      <p className="card-sub">
        Everyone who can sign in to the staff portal. Roles set a sensible starting point — tick or untick any
        individual permission from there. Assign locations to limit someone to their own store.
      </p>
      <TeamManager initialStaff={staff} locations={locations} currentId={me.id} />
    </div>
  );
}
