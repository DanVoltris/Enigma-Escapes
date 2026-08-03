import AddLocationForm from "@/components/manager/AddLocationForm";
import { requirePermission } from "@/lib/auth";
import StoreHoursEditor from "@/components/manager/StoreHoursEditor";
import { listAllLocations, locationHoursMap } from "@/lib/hours";

export const dynamic = "force-dynamic";

export default async function StoreHoursPage() {
  await requirePermission("settings", "/manager/settings/store-hours");
  const [locations, hoursMap] = await Promise.all([listAllLocations(), locationHoursMap()]);

  return (
    <>
      <p className="mgr-page-sub">
        Opening hours per location. Experiences set to “Follow store hours” generate their start times from these.
      </p>

      <AddLocationForm />

      {locations.length === 0 ? (
        <p className="mgr-empty">No locations yet — add your first above.</p>
      ) : (
        locations.map((loc) => (
          <StoreHoursEditor key={loc} location={loc} hours={hoursMap.get(loc)?.hours ?? {}} />
        ))
      )}
    </>
  );
}
