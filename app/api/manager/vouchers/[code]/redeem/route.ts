import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { redeemVoucher } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

// Spend against a voucher. The rules set on the voucher screen (dates, times,
// days, experiences, expiry, one-time use) are all enforced inside
// redeemVoucher — this route only validates the shape of the request.
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const guard = await apiGuard("bookings.modify");
  if (guard.response) return guard.response;
  const { code } = await params;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Dollars from the form, cents everywhere internally. Spaces come as a count.
  const raw = typeof o.amount === "number" ? o.amount : Number(o.amount);
  if (!Number.isFinite(raw) || raw <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than zero." }, { status: 400 });
  }
  const asSpaces = o.asSpaces === true;
  const amount = asSpaces ? Math.round(raw) : Math.round(raw * 100);

  try {
    const result = await redeemVoucher(decodeURIComponent(code), amount, {
      date: typeof o.date === "string" && o.date ? o.date : null,
      time: typeof o.time === "string" && o.time ? o.time : null,
      roomId: typeof o.roomId === "string" && o.roomId ? o.roomId : null,
      today: todayISO(),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    await logActivity(
      "Gift voucher redeemed",
      `${decodeURIComponent(code)} — ${asSpaces ? `${amount} space(s)` : `$${(amount / 100).toFixed(2)}`}`
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("redeeming gift voucher failed:", err);
    return NextResponse.json({ error: "Could not redeem that voucher right now. Please try again." }, { status: 500 });
  }
}
