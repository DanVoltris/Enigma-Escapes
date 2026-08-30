import { NextRequest, NextResponse } from "next/server";
import { currentStaff } from "@/lib/auth";
import { getPromo } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { getRewardCode, rewardProblem } from "@/lib/reward-codes";
import { getVoucher } from "@/lib/vouchers";
import { voucherProblem } from "@/lib/voucher-types";

export const dynamic = "force-dynamic";

// Checks a code typed at checkout. One box takes both kinds, so this looks in
// promo_codes first (a percentage off) and then gift_vouchers (a prepaid dollar
// balance) — they are separate tables and behave differently downstream.
//
// The bookings endpoint revalidates everything at booking time, so this is
// convenience, not authority.
export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
  if (!code || code.length > 40) {
    return NextResponse.json({ error: "Enter a code to check." }, { status: 400 });
  }
  try {
    const promo = await getPromo(code);
    // Staff-only codes answer only to a signed-in staff session (the walk-in
    // form's Apply button); to the public they don't exist.
    if (promo && promo.active && (!promo.staffOnly || (await currentStaff()))) {
      return NextResponse.json({ kind: "promo", code: promo.code, percentOff: promo.percentOff });
    }

    const voucher = await getVoucher(code);
    if (voucher) {
      // Date/experience rules need the cart, which the booking endpoint has.
      // Everything checkable without it is checked here so the customer finds
      // out now rather than after filling in their details.
      const problem = voucherProblem(voucher, { today: todayISO() });
      if (problem) return NextResponse.json({ error: problem }, { status: 409 });
      if (voucher.redemptionType === "spaces") {
        return NextResponse.json(
          { error: "That voucher is for spaces rather than a dollar amount — please call us to book it." },
          { status: 409 }
        );
      }
      return NextResponse.json({
        kind: "voucher",
        code: voucher.code,
        remainingCents: voucher.remainingCents,
      });
    }

    // Last: a 20%-off reward texted after an earlier booking. The phone and
    // session rules need the cart, so they're re-checked at booking time; what
    // can be judged without it is judged here.
    const reward = await getRewardCode(code);
    if (reward) {
      const problem = rewardProblem(reward, {
        phone: req.nextUrl.searchParams.get("phone") ?? undefined,
        sessionStart: req.nextUrl.searchParams.get("start") ?? undefined,
      });
      if (problem) return NextResponse.json({ error: problem }, { status: 409 });
      return NextResponse.json({ kind: "promo", code: reward.code, percentOff: reward.percentOff });
    }

    return NextResponse.json(
      { error: "That code is not valid. Check the spelling and try again." },
      { status: 404 }
    );
  } catch (err) {
    console.error("code lookup failed:", err);
    return NextResponse.json(
      { error: "Could not check the code right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
