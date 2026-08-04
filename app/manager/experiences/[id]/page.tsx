import Link from "next/link";
import { allowedLocations, canSeeLocation, requirePermission } from "@/lib/auth";
import { notFound } from "next/navigation";
import ExperienceForm from "@/components/manager/ExperienceForm";
import { getExperience } from "@/lib/experiences";
import { listAllLocations } from "@/lib/hours";

export const dynamic = "force-dynamic";

export default async function EditExperiencePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("experiences", "/manager/experiences/[id]");
  const { id } = await params;
  const [experience, allLocations] = await Promise.all([getExperience(id), listAllLocations()]);
  if (!experience) notFound();
  // A room at someone elses store is simply not theirs to edit.
  if (!canSeeLocation(staff, experience.location)) notFound();
  const scope = allowedLocations(staff);
  const locations = scope ? allLocations.filter((l) => scope.includes(l)) : allLocations;

  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/experiences">← Back to experiences</Link>
      </p>
      <h1 className="mgr-page-title">Edit {experience.name}</h1>
      <p className="mgr-page-sub">
        Changes apply to new bookings only — existing bookings keep the price they were sold at. To take
        this room off the booking site without deleting it, untick the box at the bottom.
      </p>
      <ExperienceForm initial={experience} locations={locations} />
    </>
  );
}
