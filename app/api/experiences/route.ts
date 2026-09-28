import { NextResponse } from "next/server";
import { listExperiences } from "@/lib/experiences";

export const dynamic = "force-dynamic";

// Public list for the browse page: what the filter needs, plus what a room that
// hasn't opened yet needs to show itself (its season, and how it looks).
export async function GET() {
  try {
    const experiences = await listExperiences({ activeOnly: true });
    return NextResponse.json({
      experiences: experiences.map((e) => ({
        id: e.id,
        name: e.name,
        location: e.location,
        tagline: e.tagline,
        priceCents: e.priceCents,
        badgeBg: e.badgeBg,
        badgeFg: e.badgeFg,
        availableFrom: e.availableFrom,
        availableTo: e.availableTo,
      })),
    });
  } catch (err) {
    console.error("experiences lookup failed:", err);
    return NextResponse.json(
      { error: "Could not load experiences right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
