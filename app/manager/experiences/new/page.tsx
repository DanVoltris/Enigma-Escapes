import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import ExperienceForm from "@/components/manager/ExperienceForm";
import { listAllLocations } from "@/lib/hours";

export const dynamic = "force-dynamic";

export default async function NewExperiencePage() {
  await requirePermission("experiences", "/manager/experiences/new");
  const locations = await listAllLocations();
  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/experiences">← Back to experiences</Link>
      </p>
      <h1 className="mgr-page-title">Add an experience</h1>
      <p className="mgr-page-sub">Fill this in and it goes live on the booking site as soon as you save.</p>
      <ExperienceForm locations={locations} />
    </>
  );
}
