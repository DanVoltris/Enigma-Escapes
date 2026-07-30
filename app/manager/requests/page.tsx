import RequestsBoard from "@/components/manager/RequestsBoard";
import { slotRemaining } from "@/lib/availability";
import { listRequests } from "@/lib/requests";
import { smsConfigured } from "@/lib/sms";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const requests = await listRequests();
  // Live remaining capacity per pending request, so the decision is informed.
  const remaining: Record<string, number | null> = {};
  for (const r of requests) {
    if (r.status === "pending") remaining[r.id] = await slotRemaining(r.roomId, r.date, r.time);
  }
  return (
    <>
      <h1 className="mgr-page-title">Booking requests</h1>
      <p className="mgr-page-sub">
        Sessions starting within 4 hours can&apos;t be booked directly — customers request them here. Accept to text
        them a payment link{smsConfigured() ? "" : " (texts aren't configured yet — copy the link and send it yourself)"};
        decline to text an apology. Requests die automatically when their start time passes.
      </p>
      <RequestsBoard initialRequests={requests} remaining={remaining} />
    </>
  );
}
