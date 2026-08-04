import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import TerminalReaders from "@/components/manager/TerminalReaders";
import { listAllLocations } from "@/lib/hours";
import { stripeConfigured, stripeMode } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export default async function PaymentsSettingsPage() {
  await requirePermission("settings", "/manager/settings/payments");
  const locations = await listAllLocations();
  const mode = stripeMode();

  return (
    <>
      <div className="mgr-card">
        <h2>Online payments</h2>
        {stripeConfigured() ? (
          <p className="card-sub">
            Stripe is connected in <strong>{mode}</strong> mode — checkout takes real card payments.
          </p>
        ) : (
          <p className="mgr-empty">
            Checkout payment is <strong>simulated</strong>: card details are checked in the customer&apos;s browser
            (Luhn + expiry) and never sent anywhere, and no money moves. Add <code>STRIPE_SECRET_KEY</code> (and{" "}
            <code>STRIPE_WEBHOOK_SECRET</code>) to the environment to switch on real payments.
          </p>
        )}
      </div>

      <div className="mgr-card">
        <h2>Card readers (Stripe Terminal)</h2>
        <TerminalReaders locations={locations} />
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
          The Today screen takes payment on the door: send an amount to the paired card reader, or record cash,
          debit, gift cards and cheques — including split across several people. Everything rolls up in Reports →
          Payments.
        </p>
        <Link href="/manager/reports?tab=payments" className="btn btn-outline">
          Open the Payments report
        </Link>
      </div>
    </>
  );
}
