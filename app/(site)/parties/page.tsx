import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

// How a group books something the booking flow doesn't sell — a Christmas
// party, a corporate night, twenty people across three rooms. The venue writes
// the whole page in Settings → Appearance & basket; with nothing written there
// is no page at all, which is how a venue that doesn't take parties opts out.
export default async function PartiesPage() {
  const site = await getSiteSettings();
  if (!site.partiesHeading && !site.partiesText) notFound();
  // Blank lines separate paragraphs, the way anyone typing into a box expects.
  const paragraphs = site.partiesText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="parties-page">
      <h1 className="page-title">{site.partiesHeading || "Parties and group bookings"}</h1>
      {paragraphs.map((text, i) => (
        <p key={i}>{text}</p>
      ))}
      <Link href="/" className="btn">
        Back to booking
      </Link>
    </div>
  );
}
