import { NextRequest, NextResponse } from "next/server";
import { createApiKey } from "@/lib/api-keys";
import { logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const label = typeof (body as { label?: unknown }).label === "string" ? (body as { label: string }).label.trim() : "";
  if (!label) return NextResponse.json({ error: "Give the key a label, e.g. the partner's name." }, { status: 400 });
  if (label.length > 60) return NextResponse.json({ error: "Keep the label under 60 characters." }, { status: 400 });

  try {
    const key = await createApiKey(label);
    await logActivity("Partner API key created", label);
    return NextResponse.json({ key }, { status: 201 });
  } catch (err) {
    console.error("creating API key failed:", err);
    const msg = err instanceof Error ? err.message : "Could not create the key right now. Please try again.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
