import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import BookingSiteForm from "@/components/manager/BookingSiteForm";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

export default async function BookingSitePage() {
  await requirePermission("settings", "/manager/settings/booking-site");
  const settings = await getSiteSettings();
  return (
    <>
      <p className="mgr-page-sub" style={{ marginBottom: 20 }}>
        Appearance and behaviour of the customer booking site.{" "}
        <Link href="/" target="_blank">
          View booking site →
        </Link>
      </p>
      <BookingSiteForm initial={settings} />
    </>
  );
}
