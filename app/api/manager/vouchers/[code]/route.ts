import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { setVoucherActive } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

// Activate / deactivate a gift voucher. Deactivating stops it being redeemed
// without deleting it — the record stays for accounting.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const guard = await apiGuard("promos");
  if (guard.response) return guard.response;
  const { code } = await params;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof o.active !== "boolean") {
    return NextResponse.json({ error: "Send whether the voucher should be active (true or false)." }, { status: 400 });
  }
  try {
    const found = await setVoucherActive(decodeURIComponent(code), o.active);
    if (!found) return NextResponse.json({ error: "That voucher code no longer exists." }, { status: 404 });
    await logActivity(o.active ? "Gift voucher activated" : "Gift voucher deactivated", decodeURIComponent(code));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updating gift voucher failed:", err);
    return NextResponse.json({ error: "Could not update that voucher right now. Please try again." }, { status: 500 });
  }
}
