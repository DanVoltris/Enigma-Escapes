import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDateLong, formatTime } from "@/lib/format";
import { getRequestByToken } from "@/lib/requests";

export const dynamic = "force-dynamic";

// This page used to be where an accepted request was paid for online. Requests
// are now confirmed by texting back Y and paid at the venue, so nothing is
// collected here — but the link lives in texts already sent, so rather than
// 404 at someone holding a real booking, it tells them where they stand.
export default async function RequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await getRequestByToken(token);
  if (!request) notFound();

  const when = `${formatDateLong(request.date)} at ${formatTime(request.time)}`;
  const state = request.status;

  return (
    <div className="panel" style={{ maxWidth: 640, margin: "40px auto" }}>
      <h1>{request.roomName}</h1>
      <p className="card-sub">
        {when} · party of {request.quantity}
      </p>

      {state === "accepted" && (
        <>
          <h2>Almost there — reply to our text</h2>
          <p>
            We&apos;re holding this session for you. Reply <strong>Y</strong> to the text we sent to{" "}
            {request.phone} to confirm it, or <strong>N</strong> to let it go.
          </p>
          <p className="sub">
            There&apos;s nothing to pay here — you pay at the venue when you arrive. If we don&apos;t hear
            back within 30 minutes of us accepting, the spot goes back up for sale.
          </p>
        </>
      )}

      {state === "confirmed" && (
        <>
          <h2>You&apos;re confirmed</h2>
          <p>See you {when}. Payment is due when you arrive — please come 10 minutes early.</p>
        </>
      )}

      {state === "pending" && (
        <>
          <h2>Waiting on us</h2>
          <p>
            We&apos;ve got your request and we&apos;re checking the room. You&apos;ll get a text as soon as
            we know — no payment needed now.
          </p>
        </>
      )}

      {(state === "declined" || state === "cancelled" || state === "expired") && (
        <>
          <h2>This one&apos;s gone</h2>
          <p>
            {state === "declined"
              ? "We couldn't fit this session in."
              : state === "cancelled"
                ? "This session was released."
                : "This session has already started."}
          </p>
          <Link href="/" className="btn">
            See other times
          </Link>
        </>
      )}

      {state === "completed" && (
        <>
          <h2>All done</h2>
          <p>This request has already been turned into a booking.</p>
        </>
      )}
    </div>
  );
}
