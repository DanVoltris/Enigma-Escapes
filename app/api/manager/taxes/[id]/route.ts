import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import { deleteTax, listTaxes, updateTax } from "@/lib/taxes";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid tax id." }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const d = body as { name?: unknown; percent?: unknown; active?: unknown };
  const patch: { name?: string; percent?: number; active?: boolean } = {};

  if (d.name !== undefined) {
    const name = typeof d.name === "string" ? d.name.trim() : "";
    if (!name || name.length > 40) return NextResponse.json({ error: "Give the tax a name (max 40 chars)." }, { status: 400 });
    patch.name = name;
  }
  if (d.percent !== undefined) {
    const percent = Number(d.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return NextResponse.json({ error: "Percentage must be between 0 and 100." }, { status: 400 });
    }
    patch.percent = percent;
  }
  if (d.active !== undefined) patch.active = d.active === true;

  try {
    const tax = (await listTaxes()).find((t) => t.id === id);
    if (!tax) return NextResponse.json({ error: "That tax no longer exists." }, { status: 404 });
    await updateTax(id, patch);
    if (patch.active !== undefined) {
      await logActivity(patch.active ? "Turned on tax" : "Turned off tax", tax.name);
    } else {
      await logActivity("Updated tax", tax.name);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updating tax failed:", err);
    return NextResponse.json({ error: "Could not update the tax right now. Please try again shortly." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid tax id." }, { status: 400 });
  try {
    const tax = (await listTaxes()).find((t) => t.id === id);
    if (!tax) return NextResponse.json({ error: "That tax no longer exists." }, { status: 404 });
    await deleteTax(id);
    await logActivity("Removed tax", tax.name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("removing tax failed:", err);
    return NextResponse.json({ error: "Could not remove the tax right now. Please try again shortly." }, { status: 500 });
  }
}
