import { NextRequest, NextResponse } from "next/server";
import { getPromo } from "@/lib/db";

export const dynamic = "force-dynamic";

// Validates a promo code for the checkout page. The bookings endpoint
// revalidates at booking time, so this is convenience, not authority.
export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
  if (!code || code.length > 40) {
    return NextResponse.json({ error: "Enter a promo code to check." }, { status: 400 });
  }
  try {
    const promo = await getPromo(code);
    if (!promo || !promo.active) {
      return NextResponse.json(
        { error: "That code is not valid. Check the spelling and try again." },
        { status: 404 }
      );
    }
    return NextResponse.json({ code: promo.code, percentOff: promo.percentOff });
  } catch (err) {
    console.error("promo lookup failed:", err);
    return NextResponse.json(
      { error: "Could not check the code right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
