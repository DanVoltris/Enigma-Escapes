import Link from "next/link";
import BlocksManager from "@/components/manager/BlocksManager";
import { listBlocks } from "@/lib/blocks";
import { listExperiences } from "@/lib/experiences";
import { todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BlocksPage() {
  // Past blocks age out of the list — only today onward is actionable.
  const [blocks, experiences] = await Promise.all([listBlocks(todayISO()), listExperiences()]);
  const roomNames = Object.fromEntries(experiences.map((e) => [e.id, `${e.name} — ${e.location}`]));
  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/calendar">← Back to calendar</Link>
      </p>
      <h1 className="mgr-page-title">Blocked hours</h1>
      <p className="mgr-page-sub">
        Take sessions out of service — maintenance, private events, short staffing. Blocked slots disappear from the
        booking site and can&apos;t be booked by customers or staff until you unblock them.
      </p>
      <BlocksManager initialBlocks={blocks} roomNames={roomNames} />
    </>
  );
}
