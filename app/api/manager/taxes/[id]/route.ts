import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { deleteTax, listTaxes, updateTax } from "@/lib/taxes";

export const dynamic = "force-dynamic";

// Taxes added here get a UUID, but seed-venue loads them with the id written in
// the venue file ("tax-hst" at Time Zone), and those must be editable too.
// Letters, digits and hyphens only, so the id can't reshape the database filter.
const ID_RE = /^[a-z0-9-]{1,64}$/i;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Invalid tax id." }, { status: 400 });

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
  const guard = await apiGuard("settings");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Invalid tax id." }, { status: 400 });
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
