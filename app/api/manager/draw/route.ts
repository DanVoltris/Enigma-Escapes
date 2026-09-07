import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { runDraw } from "@/lib/draw";

export const dynamic = "force-dynamic";

// Runs the movie-premiere draw. Admin-only on top of the Reports permission:
// staff can watch the entries pile up, but only an owner picks the winners.
export async function POST() {
  const guard = await apiGuard("reports");
  if (guard.response) return guard.response;
  if (guard.staff.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can run the draw." }, { status: 403 });
  }
  try {
    const outcome = await runDraw(guard.staff.name);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 409 });
    await logActivity(
      "Premiere draw run",
      `${outcome.result.winners.length} winner(s) from ${outcome.result.entryCount} entries`
    );
    return NextResponse.json({ ok: true, result: outcome.result });
  } catch (err) {
    console.error("running the premiere draw failed:", err);
    const msg = err instanceof Error ? err.message : "Could not run the draw right now. Please try again.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
