import DrawBoard from "@/components/manager/DrawBoard";
import { allowedLocations, requirePermission } from "@/lib/auth";
import {
  countByLocation,
  DRAW_DATE,
  DRAW_FROM,
  DRAW_TO,
  drawIsOpen,
  getDrawResult,
  listEntries,
  MOVIE_POSTER,
  MOVIE_TITLE,
  SCREENING_DATE,
  TICKETS_PER_WINNER,
  WINNERS_PER_LOCATION,
  winnersCsv,
} from "@/lib/draw";
import { listLocations } from "@/lib/experiences";
import { formatDateLong } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DrawPage() {
  const staff = await requirePermission("reports", "/manager/draw");
  const [result, entries, allLocations] = await Promise.all([getDrawResult(), listEntries(), listLocations()]);

  // A manager scoped to one venue sees only their own rows. Admins — the only
  // people who can press the button — are never scoped, so the draw itself
  // always runs across every location.
  const scope = allowedLocations(staff);
  const locations = scope ? allLocations.filter((l) => scope.includes(l)) : allLocations;

  return (
    <>
      <h1 className="mgr-page-title">Movie premiere draw</h1>
      <div className="draw-hero">
        {/* eslint-disable-next-line @next/next/no-img-element -- static file in public/, same as the rest of the portal */}
        <img src={MOVIE_POSTER} alt={`${MOVIE_TITLE} poster`} className="draw-poster" />
        <div>
          <p className="draw-prize">
            {WINNERS_PER_LOCATION * locations.length} winners × {TICKETS_PER_WINNER} tickets to{" "}
            <strong>{MOVIE_TITLE}</strong> — early screening {formatDateLong(SCREENING_DATE)}
          </p>
          <p className="mgr-page-sub">
            Every booking bought from {formatDateLong(DRAW_FROM)} to {formatDateLong(DRAW_TO)} is entered
            automatically — one entry per booking, at each location it visits. {WINNERS_PER_LOCATION} winners per
            location, {TICKETS_PER_WINNER} tickets each.
          </p>
        </div>
      </div>
      <DrawBoard
        result={result}
        csv={result ? winnersCsv(result) : null}
        locations={locations}
        entriesByLocation={countByLocation(entries)}
        totalEntries={entries.filter((e) => locations.includes(e.location)).length}
        canRun={staff.role === "admin"}
        open={drawIsOpen()}
        drawDate={formatDateLong(DRAW_DATE)}
        winnersPerLocation={WINNERS_PER_LOCATION}
        ticketsPerWinner={TICKETS_PER_WINNER}
      />
    </>
  );
}
