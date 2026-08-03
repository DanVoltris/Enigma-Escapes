import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import WalkInForm from "@/components/manager/WalkInForm";

export default async function NewWalkInPage() {
  await requirePermission("bookings.create", "/manager/bookings/new");
  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/bookings">← Back to all bookings</Link>
      </p>
      <h1 className="mgr-page-title">New walk-in booking</h1>
      <p className="mgr-page-sub">
        Record a booking taken in person or over the phone. It&apos;s tagged as in-person so you can see the
        split against online bookings on the dashboard.
      </p>
      <WalkInForm />
    </>
  );
}
