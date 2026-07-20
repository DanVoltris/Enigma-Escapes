"use client";

import { useRouter, useSearchParams } from "next/navigation";
import FilterMenu, { type FilterItem } from "@/components/FilterMenu";

type Exp = { id: string; name: string; location: string };

// Drives the calendar's location/experience filter through the URL (?f=) so it
// survives day navigation and the grid/list toggle. Reuses the customer-site
// FilterMenu for a consistent multi-select control.
export default function CalendarFilterBar({ experiences }: { experiences: Exp[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const filters = (params.get("f") ?? "").split(",").filter(Boolean);

  const locations = experiences.reduce<string[]>((acc, e) => {
    if (!acc.includes(e.location)) acc.push(e.location);
    return acc;
  }, []);

  const selectedLocations = filters.filter((f) => f.startsWith("loc:")).map((f) => f.slice(4));
  const scoped = selectedLocations.length
    ? experiences.filter((e) => selectedLocations.includes(e.location))
    : experiences;

  const items: FilterItem[] = [];
  if (locations.length > 1) {
    items.push({ heading: "Locations" });
    for (const loc of locations) items.push({ value: `loc:${loc}`, label: loc });
  }
  items.push({ heading: "Experiences" });
  for (const e of scoped) items.push({ value: `room:${e.id}`, label: e.name });

  function push(next: string[]) {
    const p = new URLSearchParams(params.toString());
    if (next.length) p.set("f", next.join(","));
    else p.delete("f");
    router.push(`/manager/calendar?${p.toString()}`);
  }

  // Once a location is chosen, drop experiences from other locations.
  function normalize(fs: string[]): string[] {
    const locs = fs.filter((f) => f.startsWith("loc:")).map((f) => f.slice(4));
    if (locs.length === 0) return fs;
    return fs.filter((f) => {
      if (!f.startsWith("room:")) return true;
      const e = experiences.find((x) => x.id === f.slice(5));
      return !!e && locs.includes(e.location);
    });
  }

  return (
    <FilterMenu
      items={items}
      selected={filters}
      onToggle={(v) => push(normalize(filters.includes(v) ? filters.filter((x) => x !== v) : [...filters, v]))}
      onClear={() => push([])}
      ariaLabel="Filter by location or experience"
      allLabel="Filter: all experiences"
    />
  );
}
