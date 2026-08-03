import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { listExperiences } from "@/lib/experiences";

export const dynamic = "force-dynamic";

// Fuller experience list for the walk-in form (needs times, price, capacity).
export async function GET() {
  const guard = await apiGuard();
  if (guard.response) return guard.response;
  try {
    const experiences = await listExperiences({ activeOnly: true });
    return NextResponse.json({
      experiences: experiences.map((e) => ({
        id: e.id,
        name: e.name,
        location: e.location,
        priceCents: e.priceCents,
        capacity: e.capacity,
        times: e.times,
      })),
    });
  } catch (err) {
    console.error("manager experiences list failed:", err);
    return NextResponse.json({ error: "Could not load experiences." }, { status: 500 });
  }
}
