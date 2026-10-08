import BoardPage from "@/components/manager/BoardPage";
import RequestsBoard from "@/components/manager/RequestsBoard";
import { allowedLocations, requirePermission } from "@/lib/auth";
import { slotRemaining } from "@/lib/availability";
import { requestWindowSentence } from "@/lib/request-window";
import { getSiteSettings } from "@/lib/site-settings";
import { sweepIfDue } from "@/lib/request-flow";
import { listRequests } from "@/lib/requests";
import { optedOutAmong, phoneKey } from "@/lib/campaigns";
import { smsConfigured } from "@/lib/sms";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const staff = await requirePermission("requests", "/manager/requests");
  const scope = allowedLocations(staff);
  const all = await listRequests();
  const site = await getSiteSettings();
  // Scoped staff only decide requests for their own stores.
  const requests = scope ? all.filter((q) => scope.includes(q.location)) : all;
  // Live remaining capacity per pending request, so the decision is informed.
  const remaining: Record<string, number | null> = {};
  for (const r of requests) {
    if (r.status === "pending") remaining[r.id] = await slotRemaining(r.roomId, r.date, r.time, r.quantity);
  }
  // Numbers that have replied STOP: Twilio refuses every text to them from our
  // number, so the accept/confirm text silently never arrives. Flagged on the
  // board so staff ring those customers instead of waiting for a Y.
  const stopped = await optedOutAmong(requests.map((r) => r.phone));
  const optedOut: Record<string, boolean> = {};
  for (const r of requests) optedOut[r.id] = stopped.has(phoneKey(r.phone));
  return (
    <>
      <BoardPage />
      <h1 className="mgr-page-title">Booking requests</h1>
      <p className="mgr-page-sub">
        {requestWindowSentence(site)} — customers request them here, and the slot is
        held from the moment they ask. Accepting books it{smsConfigured() ? " and texts them to reply Y" : " (texts aren't configured yet — call them to confirm)"};
        they pay when they arrive. If they don&apos;t reply within 30 minutes (less when the session is close — the text tells them how long) the
        hold is released. Requests die
        automatically when their start time passes.
      </p>
      <RequestsBoard initialRequests={requests} remaining={remaining} optedOut={optedOut} />
    </>
  );
}
