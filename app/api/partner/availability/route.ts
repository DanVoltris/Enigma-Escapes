import { NextRequest, NextResponse } from "next/server";
import { verifyPartnerRequest } from "@/lib/api-keys";
import { slotsForDate } from "@/lib/availability";
import { addDaysISO, isValidISODate, todayISO } from "@/lib/format";
import { getLocale } from "@/lib/locale";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

// Partner availability feed (for channels like Morty): live open slots with
// prices and deep links straight into checkout. Requires a partner API key
// from Settings → Developers. Availability only — no customer data.
export async function GET(req: NextRequest) {
  if (!(await verifyPartnerRequest(req))) {
    return NextResponse.json(
      { error: "A valid partner API key is required (Authorization: Bearer vb_...)." },
      { status: 401 }
    );
  }

  const today = todayISO();
  const date = req.nextUrl.searchParams.get("date") ?? today;
  if (!isValidISODate(date)) {
    return NextResponse.json({ error: "Invalid date. Use the format YYYY-MM-DD." }, { status: 400 });
  }
  const { windowDays } = await getSiteSettings();
  const lastBookable = addDaysISO(today, windowDays);
  if (date < today || date > lastBookable) {
    return NextResponse.json(
      { error: `Bookings are only available from today up to ${windowDays} days ahead.` },
      { status: 400 }
    );
  }

  try {
    const [slots, locale] = await Promise.all([slotsForDate(date), getLocale()]);
    const origin = req.nextUrl.origin;

    // Group flat slots by experience — the shape channels want.
    const byRoom = new Map<string, { experience: Record<string, unknown>; slots: Record<string, unknown>[] }>();
    for (const s of slots) {
      let entry = byRoom.get(s.roomId);
      if (!entry) {
        entry = {
          experience: {
            id: s.roomId,
            name: s.roomName,
            location: s.location,
            tagline: s.tagline,
            durationMinutes: s.durationMinutes,
            priceCents: s.priceCents,
            minParty: s.minParty,
            maxParty: s.maxParty,
            private: s.isPrivate,
          },
          slots: [],
        };
        byRoom.set(s.roomId, entry);
      }
      entry.slots.push({
        time: s.time,
        remaining: s.remaining,
        capacity: s.capacity,
        // Opens the booking site with this slot's panel pre-selected.
        bookUrl: `${origin}/?date=${date}&slot=${encodeURIComponent(`${s.roomId}|${s.time}`)}`,
      });
    }

    return NextResponse.json({
      date,
      currency: locale.currencyCode,
      generatedAt: new Date().toISOString(),
      experiences: [...byRoom.values()].map((e) => ({ ...e.experience, slots: e.slots })),
    });
  } catch (err) {
    console.error("partner availability failed:", err);
    return NextResponse.json({ error: "Could not load availability right now. Please retry shortly." }, { status: 500 });
  }
}
