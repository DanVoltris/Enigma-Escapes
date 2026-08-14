import TodayBoard, { type TodayRow } from "@/components/manager/TodayBoard";
import { allowedLocations, hasPermission, requirePermission } from "@/lib/auth";
import { bookingsForDate } from "@/lib/db";
import { formatDateLong, isValidISODate, nowMinutesInBusinessTZ, todayISO } from "@/lib/format";
import { listAllLocations } from "@/lib/hours";
import { terminalConfigured } from "@/lib/stripe-terminal";
import { getReaderMap } from "@/lib/terminal-settings";

export const dynamic = "force-dynamic";

// The front desk's home screen: everyone arriving today, in time order, with
// what they still owe — tap a row to see the booking and take payment.
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; loc?: string }>;
}) {
  const staff = await requirePermission("bookings.view", "/manager/today");
  const scope = allowedLocations(staff);
  const { date: raw, loc: rawLoc } = await searchParams;
  const today = todayISO();
  const date = raw && isValidISODate(raw) ? raw : today;

  // "Send to terminal" only appears when Stripe is live AND a reader is
  // actually paired with a venue — otherwise staff record payments by hand.
  const readerMap = await getReaderMap();
  const terminalReady = terminalConfigured() && Object.keys(readerMap).length > 0;

  // Venues the signed-in staff member may see — scoped accounts only get
  // theirs, so the filter can never widen what they're allowed to look at.
  const allLocations = await listAllLocations();
  const locations = scope ? allLocations.filter((l) => scope.includes(l)) : allLocations;
  const loc = rawLoc && locations.includes(rawLoc) ? rawLoc : null;

  const bookings = await bookingsForDate(date);
  const rows: TodayRow[] = [];
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    for (const item of b.items) {
      if (item.date !== date) continue;
      if (scope && !scope.includes(item.location)) continue;
      if (loc && item.location !== loc) continue;
      rows.push({
        bookingId: b.id,
        reference: b.reference,
        time: item.time,
        roomName: item.roomName,
        location: item.location,
        durationMinutes: item.durationMinutes,
        quantity: item.quantity,
        badgeBg: item.badgeBg ?? "#0B2540",
        badgeFg: item.badgeFg ?? "#fff",
        customerName: `${b.customer.firstName} ${b.customer.lastName}`.trim(),
        phone: b.customer.phone,
        email: b.customer.email,
        totalCents: b.pricing.totalCents,
        paidCents: b.pricing.paidCents,
        balanceCents: b.pricing.balanceCents,
        payments: (b.pricing.payments ?? []).map((p) => ({
          id: p.id,
          method: p.method,
          amountCents: p.amountCents,
          payer: p.payer ?? null,
        })),
        noShow: b.noShow,
        source: b.source,
      });
    }
  }
  rows.sort((a, b) => (a.time === b.time ? a.roomName.localeCompare(b.roomName) : a.time.localeCompare(b.time)));

  return (
    <TodayBoard
      terminalReady={terminalReady}
      canSetUpTerminal={hasPermission(staff, "settings")}
      rows={rows}
      date={date}
      locations={locations}
      loc={loc}
      isToday={date === today}
      dateLabel={formatDateLong(date)}
      nowMinutes={nowMinutesInBusinessTZ()}
    />
  );
}
