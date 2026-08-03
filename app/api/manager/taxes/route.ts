import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { createTax } from "@/lib/taxes";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const d = body as { name?: unknown; percent?: unknown };

  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (!name || name.length > 40) return NextResponse.json({ error: "Give the tax a name (max 40 chars)." }, { status: 400 });

  const percent = Number(d.percent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return NextResponse.json({ error: "Percentage must be between 0 and 100." }, { status: 400 });
  }

  try {
    await createTax(name, percent);
    await logActivity("Added tax", `${name} (${percent}%)`);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("creating tax failed:", err);
    return NextResponse.json({ error: "Could not add the tax right now. Please try again shortly." }, { status: 500 });
  }
}
