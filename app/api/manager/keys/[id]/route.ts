import { NextRequest, NextResponse } from "next/server";
import { revokeApiKey } from "@/lib/api-keys";
import { logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const removed = await revokeApiKey(id);
    if (!removed) return NextResponse.json({ error: "That key no longer exists." }, { status: 404 });
    await logActivity("Partner API key revoked", id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("revoking API key failed:", err);
    return NextResponse.json({ error: "Could not revoke the key right now. Please try again." }, { status: 500 });
  }
}
