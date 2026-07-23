import { BUSINESS_TIMEZONE } from "@/lib/format";

// Read-only for now: these values are wired through the whole app (lib/format,
// pricing, availability). Making them editable is a real project — every date,
// time and money formatter would need to read configuration — so this page
// states what's in force rather than pretending to edit it.
export default function LocalePage() {
  const now = new Date();
  return (
    <>
      <div className="mgr-card">
        <h2>Locale</h2>
        <p className="card-sub">What the app currently uses everywhere. Ask for this to be configurable when you need it.</p>
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <tbody>
              <tr>
                <th scope="row">Language</th>
                <td>English (Canada)</td>
              </tr>
              <tr>
                <th scope="row">Currency</th>
                <td>Canadian Dollar (CAD, $)</td>
              </tr>
              <tr>
                <th scope="row">Timezone</th>
                <td>{BUSINESS_TIMEZONE}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="mgr-card">
        <h2>Formatting</h2>
        <div className="mgr-table-wrap">
          <table className="mgr-table">
            <tbody>
              <tr>
                <th scope="row">Date format</th>
                <td>{now.toLocaleDateString("en-CA", { dateStyle: "medium", timeZone: BUSINESS_TIMEZONE })} (medium, en-CA)</td>
              </tr>
              <tr>
                <th scope="row">Time format</th>
                <td>{now.toLocaleTimeString("en-CA", { timeStyle: "short", timeZone: BUSINESS_TIMEZONE })} (12-hour)</td>
              </tr>
              <tr>
                <th scope="row">Currency format</th>
                <td>$12.34</td>
              </tr>
              <tr>
                <th scope="row">First day of the week</th>
                <td>Sunday (calendar grids)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
