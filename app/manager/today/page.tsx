import TodayBoard, { type TodayRow } from "@/components/manager/TodayBoard";
import { allowedLocations, requirePermission } from "@/lib/auth";
import { bookingsForDate } from "@/lib/db";
import { formatDateLong, isValidISODate, nowMinutesInBusinessTZ, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";

// The front desk's home screen: everyone arriving today, in time order, with
// what they still owe — tap a row to see the booking and take payment.
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const staff = await requirePermission("bookings.view", "/manager/today");
  const scope = allowedLocations(staff);
  const { date: raw } = await searchParams;
  const today = todayISO();
  const date = raw && isValidISODate(raw) ? raw : today;

  const bookings = await bookingsForDate(date);
  const rows: TodayRow[] = [];
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    for (const item of b.items) {
      if (item.date !== date) continue;
      if (scope && !scope.includes(item.location)) continue;
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
      rows={rows}
      date={date}
      isToday={date === today}
      dateLabel={formatDateLong(date)}
      nowMinutes={nowMinutesInBusinessTZ()}
    />
  );
}
