import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { getExperience, updateExperience } from "@/lib/experiences";
import { parseExperienceInput } from "@/lib/experience-validation";
import { logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("experiences");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseExperienceInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const existing = await getExperience(id);
    if (!existing) return NextResponse.json({ error: "That experience no longer exists." }, { status: 404 });
    await updateExperience(id, parsed);
    await logActivity("Edited experience", `${parsed.name}${parsed.active ? "" : " (hidden)"}`);
    return NextResponse.json({ id });
  } catch (err) {
    console.error("updating experience failed:", err);
    return NextResponse.json(
      { error: "Could not save your changes right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
