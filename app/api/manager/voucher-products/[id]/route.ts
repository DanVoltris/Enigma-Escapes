import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { deleteVoucherProduct, updateVoucherProduct } from "@/lib/voucher-products";

export const dynamic = "force-dynamic";

// Rename, re-describe, or take a voucher on and off sale.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("promos");
  if (guard.response) return guard.response;
  const { id } = await params;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: { name?: string; description?: string | null; active?: boolean } = {};
  if (typeof o.name === "string") {
    if (!o.name.trim()) return NextResponse.json({ error: "Give the voucher a name." }, { status: 400 });
    patch.name = o.name.trim().slice(0, 80);
  }
  if (typeof o.description === "string") patch.description = o.description.trim().slice(0, 240) || null;
  if (typeof o.active === "boolean") patch.active = o.active;

  try {
    const found = await updateVoucherProduct(id, patch);
    if (!found) return NextResponse.json({ error: "That voucher no longer exists." }, { status: 404 });
    if (patch.active !== undefined) {
      await logActivity(patch.active ? "Voucher put on sale" : "Voucher taken off sale", id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updating voucher product failed:", err);
    return NextResponse.json({ error: "Could not update that voucher right now. Please try again." }, { status: 500 });
  }
}

// Removes it from the catalogue only. Vouchers already sold at that amount keep
// their balances — those are money customers are owed.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("promos");
  if (guard.response) return guard.response;
  const { id } = await params;
  try {
    const removed = await deleteVoucherProduct(id);
    if (!removed) return NextResponse.json({ error: "That voucher no longer exists." }, { status: 404 });
    await logActivity("Voucher product removed", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleting voucher product failed:", err);
    return NextResponse.json({ error: "Could not remove that voucher right now. Please try again." }, { status: 500 });
  }
}
