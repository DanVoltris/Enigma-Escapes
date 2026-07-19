import { NextRequest, NextResponse } from "next/server";
import { createExperience, getExperience, listExperiences } from "@/lib/experiences";
import { parseExperienceInput, slugify } from "@/lib/experience-validation";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseExperienceInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const id = slugify(parsed.name);
    if (!id) return NextResponse.json({ error: "The name needs at least one letter or number." }, { status: 400 });
    if (await getExperience(id)) {
      return NextResponse.json(
        { error: "An experience with a very similar name already exists. Pick a different name." },
        { status: 409 }
      );
    }
    const all = await listExperiences();
    const sort = Math.max(0, ...all.map((e) => e.sort)) + 1;
    await createExperience({ ...parsed, id, sort });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error("creating experience failed:", err);
    return NextResponse.json(
      { error: "Could not save the experience right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
