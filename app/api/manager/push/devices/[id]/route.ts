import { NextRequest, NextResponse } from "next/server";
import { apiGuard, hasPermission } from "@/lib/auth";
import { deleteDevice, listDevices } from "@/lib/push";

export const dynamic = "force-dynamic";

// Remove a phone from someone's notifications: your own from the Notifications
// page, or anyone's from Team (a lost phone, someone who has left).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard();
  if (guard.response) return guard.response;
  const { id } = await params;
  const device = (await listDevices(`&id=eq.${encodeURIComponent(id)}&limit=1`))[0];
  if (!device) return NextResponse.json({ ok: true }); // already gone
  if (device.staff_id !== guard.staff.id && !hasPermission(guard.staff, "staff")) {
    return NextResponse.json({ error: "You can only remove your own devices." }, { status: 403 });
  }
  try {
    await deleteDevice(device.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("removing notification device failed:", err);
    return NextResponse.json({ error: "Could not remove that device. Please try again." }, { status: 500 });
  }
}
