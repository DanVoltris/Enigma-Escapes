export default function WaiversPage() {
  return (
    <div className="mgr-card">
      <h2>Waivers</h2>
      <p className="card-sub">Digital liability waivers guests sign as part of booking.</p>
      <p className="mgr-empty">
        Not built yet — this is a real feature, not just a settings screen. It needs a signing step in the customer
        checkout (waiver text + agreement, optionally per-guest details like name and date of birth) and storage of who
        signed and when, so you can prove it later.
      </p>
      <p className="card-sub" style={{ marginTop: 16 }}>
        If you collect paper waivers today and want them digital and attached to each booking, tell me the fields you
        need and whether every guest signs or just the lead booker, and I&apos;ll scope it.
      </p>
    </div>
  );
}
