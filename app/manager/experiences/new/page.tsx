import Link from "next/link";
import { allowedLocations, requirePermission } from "@/lib/auth";
import ExperienceForm from "@/components/manager/ExperienceForm";
import { listAllLocations } from "@/lib/hours";

export const dynamic = "force-dynamic";

export default async function NewExperiencePage() {
  const staff = await requirePermission("experiences", "/manager/experiences/new");
  const scope = allowedLocations(staff);
  const all = await listAllLocations();
  // Store-scoped staff can only add rooms at their own store.
  const locations = scope ? all.filter((l) => scope.includes(l)) : all;
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
