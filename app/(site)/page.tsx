import BrowsePage, { type ExperienceSummary } from "@/components/BrowsePage";
import { slotsForDate } from "@/lib/availability";
import { listExperiences } from "@/lib/experiences";
import { addDaysISO, isValidISODate, todayISO } from "@/lib/format";
import { getSiteSettings } from "@/lib/site-settings";
import type { Slot } from "@/lib/types";

export const dynamic = "force-dynamic";

// Loads the day's sessions and the room list here, so the browse page arrives
// with them instead of fetching both after its JavaScript has loaded — which on
// a quiet venue meant a visible wait with "Loading availability…" on screen.
// The date is the one a deep link asks for (?date=), when it's bookable.
export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: asked } = await searchParams;
  const today = todayISO();
  const { windowDays } = await getSiteSettings();
  const date =
    asked && isValidISODate(asked) && asked >= today && asked <= addDaysISO(today, windowDays) ? asked : today;

  // Either lookup failing leaves the browser to fetch it, as it always did.
  const [slots, experiences] = await Promise.all([
    slotsForDate(date).catch((err): Slot[] | null => {
      console.error("server availability lookup failed:", err);
      return null;
    }),
    listExperiences({ activeOnly: true })
      .then((list): ExperienceSummary[] => list.map((e) => ({ id: e.id, name: e.name, location: e.location })))
      .catch((): ExperienceSummary[] | null => null),
  ]);

  return <BrowsePage initialDate={date} initialSlots={slots} initialExperiences={experiences} />;
}
