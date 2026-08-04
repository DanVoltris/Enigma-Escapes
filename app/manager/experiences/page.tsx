import Link from "next/link";
import { allowedLocations, requirePermission } from "@/lib/auth";
import RoomBadge from "@/components/RoomBadge";
import { listExperiences } from "@/lib/experiences";
import { formatMoney, formatTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ManagerExperiences({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const staff = await requirePermission("experiences", "/manager/experiences");
  const scope = allowedLocations(staff);
  const { saved } = await searchParams;
  const all = await listExperiences();
  // Store-scoped staff manage only their own rooms.
  const experiences = scope ? all.filter((e) => scope.includes(e.location)) : all;

  return (
    <>
      <h1 className="mgr-page-title">Experiences</h1>
      <p className="mgr-page-sub">
        The escape rooms customers can book. Changes here appear on the booking site immediately.
      </p>

      {saved && <div className="mgr-success">Saved — your changes are live on the booking site.</div>}

      <div className="mgr-actions-row">
        <span style={{ color: "var(--text-secondary)" }}>
          {experiences.length} experience{experiences.length === 1 ? "" : "s"}
        </span>
        <Link href="/manager/experiences/new" className="btn">
          + Add experience
        </Link>
      </div>

      <div className="mgr-table-wrap">
        <table className="mgr-table">
          <thead>
            <tr>
              <th>Experience</th>
              <th>Location</th>
              <th className="num">Price / person</th>
              <th className="num">Capacity</th>
              <th>Daily sessions</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {experiences.map((e) => (
              <tr key={e.id}>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {e.imageUrl ? (
                      <img src={e.imageUrl} alt="" className="mgr-thumb" />
                    ) : (
                      <RoomBadge name={e.name} bg={e.badgeBg} fg={e.badgeFg} />
                    )}
                    <strong>{e.name}</strong>
                  </span>
                </td>
                <td>{e.location}</td>
                <td className="num">{formatMoney(e.priceCents)}</td>
                <td className="num">{e.capacity}</td>
                <td>
                  {e.scheduleMode === "times"
                    ? e.times.length > 0
                      ? `${e.times.length} set times (${formatTime(e.times[0])}–${formatTime(e.times[e.times.length - 1])})`
                      : "No times set"
                    : e.scheduleMode === "window"
                      ? `Weekly window · every ${e.intervalMinutes} min`
                      : `Store hours · every ${e.intervalMinutes} min`}
                </td>
                <td>
                  <span className={`mgr-pill${e.active ? " on" : ""}`}>{e.active ? "Live" : "Hidden"}</span>
                </td>
                <td>
                  <Link href={`/manager/experiences/${e.id}`}>Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
