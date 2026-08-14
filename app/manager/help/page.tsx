import Link from "next/link";

export default function ManagerHelp() {
  return (
    <div className="mgr-help">
      <h1 className="mgr-page-title">Help</h1>
      <p className="mgr-page-sub">A quick guide to running Voltris Booking.</p>

      <h2>Daily routine</h2>
      <ul>
        <li>
          <strong>Dashboard</strong> shows today at a glance: how many games and guests are coming, and
          which sessions are still ahead.
        </li>
        <li>
          <strong>Calendar</strong> shows every session for any date and how full each one is. Click a
          session with guests to jump to its bookings.
        </li>
      </ul>

      <h2>Managing bookings</h2>
      <ul>
        <li>
          <strong>Bookings</strong> lists every booking. Search by name, email, phone, reference or
          experience. Open one to see contact details, sessions, and what&apos;s still owing.
        </li>
        <li>
          A red <strong>balance due</strong> means the customer paid a deposit online — collect the rest
          when they arrive.
        </li>
        <li>
          <strong>Customers</strong> groups bookings by person, so you can see repeat visitors and who
          agreed to marketing emails.
        </li>
        <li>
          <strong>Walk-ins:</strong> take a booking in person or over the phone with{" "}
          <strong>Book now</strong> on the Bookings page. It&apos;s tagged in-person and counts
          toward the online-vs-in-person split on the dashboard.
        </li>
        <li>
          <strong>No-shows:</strong> open a booking and use the Attendance box to mark it a no-show if the
          party doesn&apos;t arrive. No-show numbers appear on the dashboard.
        </li>
      </ul>

      <h2>Your dashboard</h2>
      <ul>
        <li>
          The <strong>Performance</strong> section (7/30/90-day toggle) shows bookings, guests, sales, the
          money breakdown, best/quietest days, the online-vs-in-person split, and no-shows.
        </li>
        <li>
          <strong>Staff notes</strong> are shared reminders for the team. <strong>Recent activity</strong>{" "}
          logs changes made in the portal (edited a room, added a promo, marked a no-show, etc.).
        </li>
      </ul>

      <h2>Changing what customers can book</h2>
      <ul>
        <li>
          <strong>Experiences</strong> is where you add rooms, change prices, times, capacity, or take a
          room off sale (untick &quot;visible and bookable&quot; — nothing gets deleted).
        </li>
        <li>Changes go live on the booking site the moment you save.</li>
        <li>
          Bookings need at least <strong>4 players</strong>; capacity is per session.
        </li>
        <li>
          <strong>Promo codes</strong> creates percentage discounts. Turning a code off stops new uses
          instantly.
        </li>
      </ul>

      <h2>Money</h2>
      <ul>
        <li>
          Customers pay online either the full amount or a 25% deposit. Taxes are set on the{" "}
          <strong>Settings → Taxes</strong> tab (GST 5% by default).
        </li>
        <li>
          <strong>Reports</strong> totals sales by the date sessions run. &quot;Gross&quot; is ticket
          price × guests before tax and discounts.
        </li>
        <li>
          Payments are currently <strong>simulated</strong> — no real money moves. Connecting a real
          payment provider (Stripe) is a planned next step.
        </li>
      </ul>

      <h2>Good to know</h2>
      <ul>
        <li>
          This portal has <strong>no login yet</strong> — anyone with the address can open it. Ask your
          developer to add a login before sharing the link.
        </li>
        <li>
          The customer-facing site is at <Link href="/">the booking site</Link> — what you see there is
          exactly what customers see.
        </li>
      </ul>
    </div>
  );
}
