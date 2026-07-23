export default function VisitorsPage() {
  return (
    <>
      <div className="mgr-card">
        <h2>Customer accounts</h2>
        <p className="mgr-empty">
          Customers book as guests — there are no customer logins. Their history is grouped by email on the Customers
          tab instead.
        </p>
      </div>
      <div className="mgr-card">
        <h2>Waivers</h2>
        <p className="mgr-empty">
          Waivers aren&apos;t collected yet. If you use paper waivers today and want digital ones attached to bookings,
          ask for it — it needs a signing step in checkout plus storage.
        </p>
      </div>
    </>
  );
}
