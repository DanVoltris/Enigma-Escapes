import StoreHoursEditor from "@/components/manager/StoreHoursEditor";
import { listLocations } from "@/lib/experiences";
import { locationHoursMap } from "@/lib/hours";

export const dynamic = "force-dynamic";

export default async function StoreHoursPage() {
  const [locations, hoursMap] = await Promise.all([listLocations(), locationHoursMap()]);

  return (
    <>
      <h1 className="mgr-page-title">Store hours</h1>
      <p className="mgr-page-sub">
        Opening hours per location. Experiences set to “Follow store hours” generate their start times from these.
      </p>

      {locations.length === 0 ? (
        <p className="mgr-empty">
          No locations yet. Add an experience first (its location becomes available here).
        </p>
      ) : (
        locations.map((loc) => (
          <StoreHoursEditor key={loc} location={loc} hours={hoursMap.get(loc)?.hours ?? {}} />
        ))
      )}
    </>
  );
}
