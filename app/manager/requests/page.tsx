import RequestsBoard from "@/components/manager/RequestsBoard";
import { allowedLocations, requirePermission } from "@/lib/auth";
import { slotRemaining } from "@/lib/availability";
import { sweepIfDue } from "@/lib/request-flow";
import { listRequests } from "@/lib/requests";
import { smsConfigured } from "@/lib/sms";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const staff = await requirePermission("requests", "/manager/requests");
  const scope = allowedLocations(staff);
  const all = await listRequests();
  // Scoped staff only decide requests for their own stores.
  const requests = scope ? all.filter((q) => scope.includes(q.location)) : all;
  // Live remaining capacity per pending request, so the decision is informed.
  const remaining: Record<string, number | null> = {};
  for (const r of requests) {
    if (r.status === "pending") remaining[r.id] = await slotRemaining(r.roomId, r.date, r.time);
  }
  return (
    <>
      <h1 className="mgr-page-title">Booking requests</h1>
      <p className="mgr-page-sub">
        Sessions starting within 4 hours can&apos;t be booked directly — customers request them here, and the slot is
        held from the moment they ask. Accepting books it{smsConfigured() ? " and texts them to reply Y" : " (texts aren't configured yet — call them to confirm)"};
        they pay when they arrive. If they don&apos;t reply within 30 minutes the hold is released. Requests die
        automatically when their start time passes.
      </p>
      <RequestsBoard initialRequests={requests} remaining={remaining} />
    </>
  );
}
