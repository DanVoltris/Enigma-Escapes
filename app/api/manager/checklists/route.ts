import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { normalizeChecklists, saveChecklists } from "@/lib/checklists";
import { logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

// Full-replace of the checklist definitions (small data, simplest correct).
export async function PUT(req: NextRequest) {
  const guard = await apiGuard("checklists");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const lists = normalizeChecklists((body as { lists?: unknown }).lists);
  if (lists === null) {
    return NextResponse.json(
      { error: "Every checklist needs a name and every task needs text (max 30 lists, 50 tasks each)." },
      { status: 400 }
    );
  }
  try {
    await saveChecklists(lists);
    await logActivity("Checklists updated", `${lists.length} list(s)`);
    return NextResponse.json({ ok: true, lists });
  } catch (err) {
    console.error("saving checklists failed:", err);
    const msg = err instanceof Error ? err.message : "Could not save right now. Please try again.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
