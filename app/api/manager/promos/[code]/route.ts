import { NextRequest, NextResponse } from "next/server";
import { getPromo, logActivity, updatePromo } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await ctx.params;
  const code = decodeURIComponent(rawCode).toUpperCase();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const d = body as { active?: unknown };
  if (typeof d.active !== "boolean") {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    if (!(await getPromo(code))) {
      return NextResponse.json({ error: "That code no longer exists." }, { status: 404 });
    }
    await updatePromo(code, { active: d.active });
    await logActivity(d.active ? "Turned on promo code" : "Turned off promo code", code);
    return NextResponse.json({ code });
  } catch (err) {
    console.error("updating promo failed:", err);
    return NextResponse.json(
      { error: "Could not update the code right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
