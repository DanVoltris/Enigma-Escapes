import { NextResponse } from "next/server";
import { listExperiences } from "@/lib/experiences";

export const dynamic = "force-dynamic";

// Public list for the browse page filter: names and locations only.
export async function GET() {
  try {
    const experiences = await listExperiences({ activeOnly: true });
    return NextResponse.json({
      experiences: experiences.map((e) => ({ id: e.id, name: e.name, location: e.location })),
    });
  } catch (err) {
    console.error("experiences lookup failed:", err);
    return NextResponse.json(
      { error: "Could not load experiences right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
