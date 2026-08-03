import Link from "next/link";
import { requirePermission } from "@/lib/auth";

export default async function PaymentsSettingsPage() {
  await requirePermission("settings", "/manager/settings/payments");
  return (
    <>
      <div className="mgr-card">
        <h2>Online payments</h2>
        <p className="mgr-empty">
          Checkout payment is <strong>simulated</strong>: card details are checked in the customer&apos;s browser (Luhn +
          expiry) and never sent anywhere, and no money moves. Connecting a real processor (Stripe) is a separate
          project and needs the staff login first.
        </p>
      </div>
      <div className="mgr-card">
        <h2>Deposits</h2>
        <p className="card-sub">
          Each experience sets its own deposit percentage; carts blend them by spend. Edit them on the experience
          itself.
        </p>
        <Link href="/manager/experiences" className="btn btn-outline">
          Open Experiences
        </Link>
      </div>
      <div className="mgr-card">
        <h2>Payments at the venue</h2>
        <p className="card-sub">
          Staff can record cash / terminal / e-transfer payments on a booking&apos;s Payments tab — bookkeeping only, no
          card is charged. They roll up in Reports → Payments.
        </p>
        <Link href="/manager/reports?tab=payments" className="btn btn-outline">
          Open the Payments report
        </Link>
      </div>
    </>
  );
}
