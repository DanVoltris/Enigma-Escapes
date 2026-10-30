import BoardPage from "@/components/manager/BoardPage";
import Link from "next/link";
import { allowedLocations, requirePermission } from "@/lib/auth";
import BlockRules from "@/components/manager/BlockRules";
import BlocksManager from "@/components/manager/BlocksManager";
import { listBlockRules, listBlocks, weeklyStartTimes } from "@/lib/blocks";
import { listExperiences } from "@/lib/experiences";
import { todayISO } from "@/lib/format";
import { locationHoursMap } from "@/lib/hours";

export const dynamic = "force-dynamic";

export default async function BlocksPage() {
  const staff = await requirePermission("blocks", "/manager/blocks");
  const scope = allowedLocations(staff);
  const today = todayISO();
  // Past blocks age out of the list — only today onward is actionable.
  const [blocks, rules, experiences, hoursMap] = await Promise.all([
    listBlocks(today),
    listBlockRules(),
    listExperiences(),
    locationHoursMap(),
  ]);
  const visible = scope ? experiences.filter((e) => scope.includes(e.location)) : experiences;
  const roomNames = Object.fromEntries(visible.map((e) => [e.id, `${e.name} — ${e.location}`]));
  const mine = new Set(visible.map((e) => e.id));
  const scopedBlocks = scope ? blocks.filter((x) => mine.has(x.roomId)) : blocks;
  // A rule that has ended is history, not something anyone needs to act on.
  const liveRules = rules.filter((r) => mine.has(r.roomId) && (r.until === null || r.until >= today));
  // Only rooms on sale can be given a new rule; names cover every room, so a
  // block on one since switched off still says whose it is.
  const rooms = visible.filter((e) => e.active).map((e) => ({
    id: e.id,
    name: e.name,
    location: e.location,
    week: weeklyStartTimes(e, hoursMap.get(e.location) ?? null, today),
  }));
  return (
    <>
      <BoardPage />
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/calendar">← Back to calendar</Link>
      </p>
      <h1 className="mgr-page-title">Blocked hours</h1>
      <p className="mgr-page-sub">
        Take sessions out of service — maintenance, private events, short staffing. Blocked slots disappear from the
        booking site and can&apos;t be booked by customers or staff until you unblock them. To change what a room
        normally runs, or run different times on some dates, edit the room in{" "}
        <Link href="/manager/experiences">Experiences</Link>.
      </p>
      <BlocksManager initialBlocks={scopedBlocks} roomNames={roomNames} />
      <BlockRules rooms={rooms} rules={liveRules} roomNames={roomNames} />
    </>
  );
}
