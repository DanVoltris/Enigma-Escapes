import Link from "next/link";
import { notFound } from "next/navigation";
import RequestCompletion from "@/components/RequestCompletion";
import { getExperience } from "@/lib/experiences";
import { formatDateLong, formatTime } from "@/lib/format";
import { getRequestByToken } from "@/lib/requests";

export const dynamic = "force-dynamic";

// Landing page from the "accepted" text: seeds the cart with the approved
// slot and sends the customer through normal checkout to pay.
export default async function RequestTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await getRequestByToken(token);
  if (!request) notFound();

  const heading = `${request.roomName} — ${formatDateLong(request.date)}, ${formatTime(request.time)}`;

  if (request.status === "completed") {
    return (
      <div className="empty-state">
        <h1 className="page-title">All done!</h1>
        <p>This booking is already completed and paid — see you at {formatTime(request.time)}.</p>
      </div>
    );
  }
  if (request.status === "declined") {
    return (
      <div className="empty-state">
        <h1 className="page-title">This request was declined</h1>
        <p>Sorry — we couldn&apos;t fit {heading}.</p>
        <p style={{ marginTop: 16 }}>
          <Link href="/" className="btn">
            See other times
          </Link>
        </p>
      </div>
    );
  }
  if (request.status === "expired") {
    return (
      <div className="empty-state">
        <h1 className="page-title">This request has expired</h1>
        <p>The session time for {heading} has passed.</p>
        <p style={{ marginTop: 16 }}>
          <Link href="/" className="btn">
            Book another time
          </Link>
        </p>
      </div>
    );
  }
  if (request.status === "pending") {
    return (
      <div className="empty-state">
        <h1 className="page-title">Still being reviewed</h1>
        <p>
          Your request for {heading} hasn&apos;t been decided yet — we&apos;ll text {request.phone} the moment it is.
        </p>
      </div>
    );
  }

  // accepted → seed the cart and continue to checkout
  const exp = await getExperience(request.roomId);
  if (!exp) notFound();
  return (
    <RequestCompletion
      token={request.token}
      item={{
        roomId: exp.id,
        roomName: exp.name,
        location: exp.location,
        date: request.date,
        time: request.time,
        quantity: request.quantity,
        priceCents: exp.priceCents,
        durationMinutes: exp.durationMinutes,
        depositPercent: exp.depositPercent,
        badgeBg: exp.badgeBg,
        badgeFg: exp.badgeFg,
      }}
      customer={{
        firstName: request.firstName,
        lastName: request.lastName,
        email: request.email ?? "",
        phone: request.phone,
        subscribe: false,
      }}
    />
  );
}
