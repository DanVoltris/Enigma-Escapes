import { NextRequest, NextResponse } from "next/server";
import { verifyPartnerRequest } from "@/lib/api-keys";
import { bookingsForDate } from "@/lib/db";
import { isValidISODate, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";

// Partner sessions feed (for photo/video partners like Fotaflo): which groups
// played on a date, per session, so photos can be matched to bookings.
// Deliberately contains NO contact details (emails/phones) — the manager
// portal that mints partner keys has no login yet, so this feed stays
// PII-light until staff auth exists. Past dates are allowed (photos are
// delivered after the visit). Paid bookings only.
export async function GET(req: NextRequest) {
  if (!(await verifyPartnerRequest(req))) {
    return NextResponse.json(
      { error: "A valid partner API key is required (Authorization: Bearer vb_...)." },
      { status: 401 }
    );
  }

  const date = req.nextUrl.searchParams.get("date") ?? todayISO();
  if (!isValidISODate(date)) {
    return NextResponse.json({ error: "Invalid date. Use the format YYYY-MM-DD." }, { status: 400 });
  }

  try {
    const bookings = (await bookingsForDate(date)).filter((b) => b.status === "paid");
    const sessions = bookings.flatMap((b) =>
      b.items
        .filter((i) => i.date === date)
        .map((i) => ({
          reference: b.reference,
          experienceId: i.roomId,
          experience: i.roomName,
          location: i.location,
          time: i.time,
          durationMinutes: i.durationMinutes,
          quantity: i.quantity,
          noShow: b.noShow,
          groupName: `${b.customer.firstName} ${b.customer.lastName.charAt(0)}.`.trim(),
        }))
    );
    sessions.sort((a, b) => a.time.localeCompare(b.time));
    return NextResponse.json({ date, generatedAt: new Date().toISOString(), sessions });
  } catch (err) {
    console.error("partner sessions feed failed:", err);
    return NextResponse.json({ error: "Could not load sessions right now. Please retry shortly." }, { status: 500 });
  }
}
