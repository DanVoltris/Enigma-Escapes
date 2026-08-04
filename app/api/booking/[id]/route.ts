import { NextRequest, NextResponse } from "next/server";
import { getBooking } from "@/lib/db";
import { isValidISODate } from "@/lib/format";
import { cancelForCustomer, rescheduleForCustomer, selfServiceBlock } from "@/lib/manage-booking";

export const dynamic = "force-dynamic";

// Customer self-service on their own booking. The booking id is the secret
// (a v4 UUID — the same link they already got on their confirmation), so
// there's nothing extra to leak, and every action re-checks the 24h cutoff
// server-side rather than trusting the page.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: "We couldn't find that booking." }, { status: 404 });

  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = o.action === "cancel" || o.action === "reschedule" ? o.action : null;
  if (!action) return NextResponse.json({ error: "Choose cancel or reschedule." }, { status: 400 });

  const block = selfServiceBlock(booking);
  if (block.blocked) return NextResponse.json({ error: block.reason }, { status: 400 });

  try {
    if (action === "cancel") {
      const result = await cancelForCustomer(booking);
      return NextResponse.json({
        ok: true,
        refundedCents: result.refundedCents,
        owedCents: result.owedCents,
        automatic: result.automatic,
      });
    }

    const date = typeof o.date === "string" ? o.date : "";
    const time = typeof o.time === "string" ? o.time : "";
    if (!isValidISODate(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return NextResponse.json({ error: "Pick a new date and time." }, { status: 400 });
    }
    const result = await rescheduleForCustomer(booking, date, time);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("customer booking change failed:", err);
    return NextResponse.json(
      { error: "Something went wrong — please call us and we'll sort it out." },
      { status: 500 }
    );
  }
}
