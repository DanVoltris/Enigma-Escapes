import { NextRequest, NextResponse } from "next/server";
import { sweepAwaitingReplies } from "@/lib/request-flow";

export const dynamic = "force-dynamic";

// Nudges customers who haven't replied Y yet, and releases the slots of those
// who never do. Run by Vercel Cron every 5 minutes (see vercel.json), so a
// reminder lands 15-20 minutes after acceptance and the hold is released at
// 30-35 — a few minutes of slack rather than a promise of exactness.
//
// Idempotent by design: the reminder is stamped once, and a released request
// stops being awaiting-a-reply. Running it twice does nothing the first run
// didn't already do.
export async function GET(req: NextRequest) {
  // Vercel sends its cron secret; nothing else should be able to run this.
  //
  // Fails closed. This used to skip the check entirely when CRON_SECRET was
  // unset, which left an endpoint that sends text messages open to anyone who
  // guessed the path. Nothing is lost by refusing: no vercel.json schedules
  // this, and the sweep it runs already happens by itself through sweepIfDue()
  // on ordinary traffic. So an unconfigured secret means the endpoint is
  // simply inert until someone sets one on purpose.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new NextResponse("This endpoint is disabled: CRON_SECRET is not configured.", { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const result = await sweepAwaitingReplies(req.nextUrl.origin);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("request sweep failed:", err);
    return NextResponse.json({ error: "Sweep failed." }, { status: 500 });
  }
}
