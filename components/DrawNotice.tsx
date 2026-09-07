import { DRAW_DATE, isInDrawWindow, MOVIE_POSTER, MOVIE_TITLE, SCREENING_DATE, TICKETS_PER_WINNER } from "@/lib/draw";
import { formatDateLong } from "@/lib/format";

// The "you're in the draw" notice, shown wherever a customer looks at their
// booking: the confirmation page straight after checkout, and the manage page
// the confirmation text links to. One component so the two can't drift — it
// started out on the confirmation page alone, which the texted link never
// reaches, so anyone following the text saw nothing. Renders nothing for a
// booking outside the entry window. Temporary, goes with the rest of the
// promotion.
export default function DrawNotice({ createdAt }: { createdAt: string }) {
  if (!isInDrawWindow(createdAt)) return null;
  return (
    <div className="draw-note">
      {/* eslint-disable-next-line @next/next/no-img-element -- static file in public/ */}
      <img src={MOVIE_POSTER} alt={`${MOVIE_TITLE} poster`} className="draw-note-poster" />
      <p className="confirm-note">
        You&apos;re in the draw! Your booking is entered automatically, and we&apos;re giving{" "}
        {TICKETS_PER_WINNER} tickets to an early screening of <strong>{MOVIE_TITLE}</strong> on{" "}
        {formatDateLong(SCREENING_DATE)}{" "}
        — ahead of its release — to winners at each of our locations. We draw on{" "}
        {formatDateLong(DRAW_DATE)}{" "}
        and will be in touch if you&apos;ve won.
      </p>
    </div>
  );
}
