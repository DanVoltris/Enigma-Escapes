import { NextRequest, NextResponse } from "next/server";
import { setItemChecked } from "@/lib/checklists";

export const dynamic = "force-dynamic";

// Tick/untick one task for today.
export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  if (typeof o.itemId !== "string" || !o.itemId || typeof o.checked !== "boolean") {
    return NextResponse.json({ error: "Send an itemId and whether it's checked." }, { status: 400 });
  }
  try {
    const state = await setItemChecked(o.itemId, o.checked);
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    console.error("saving checklist state failed:", err);
    return NextResponse.json({ error: "Could not save the tick right now. Please try again." }, { status: 500 });
  }
}
