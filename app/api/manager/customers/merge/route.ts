import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import {
  aggregateCustomers,
  deleteManualCustomer,
  listManualCustomers,
  upsertManualCustomer,
  type ImportedHistory,
} from "@/lib/customers";
import { listBookings, logActivity, updateBookingCustomer } from "@/lib/db";

export const dynamic = "force-dynamic";

const SUMMED = [
  "transactions",
  "bookings",
  "bookingValueCents",
  "paidCents",
  "unpaidCents",
  "overpaidCents",
  "creditCents",
  "creditRemainingCents",
  "vouchers",
  "voucherValueCents",
] as const;

// Two people's old-system totals as one: the counts and money add up, the same
// way scripts/import-customers.mjs combines one person's two legacy accounts.
// The kept customer's own details win; the other's only fill gaps.
function combineImported(kept: ImportedHistory, merged: ImportedHistory): ImportedHistory {
  const out: ImportedHistory = { ...merged };
  for (const [k, v] of Object.entries(kept)) if (v != null) (out as Record<string, unknown>)[k] = v;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  for (const k of SUMMED) out[k] = n(kept[k]) + n(merged[k]);
  const ids = [...(kept.mergedFrom ?? [kept.legacyId]), ...(merged.mergedFrom ?? [merged.legacyId])];
  out.mergedFrom = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))];
  return out;
}

// Merge one customer identity into another: every booking under fromEmail is
// rewritten to the kept customer's email/name/phone (participants preserved),
// and fromEmail's manual entry is removed. Deliberately normalizes history —
// that's what a staff-initiated merge is for. Not reversible.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("customers.view");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;
  const fromEmail = typeof o.fromEmail === "string" ? o.fromEmail.trim().toLowerCase() : "";
  const toEmail = typeof o.toEmail === "string" ? o.toEmail.trim().toLowerCase() : "";
  if (!fromEmail || !toEmail) return NextResponse.json({ error: "Pick both customers first." }, { status: 400 });
  if (fromEmail === toEmail) {
    return NextResponse.json({ error: "Those are the same customer — pick two different ones." }, { status: 400 });
  }

  try {
    const [bookings, manual] = await Promise.all([listBookings(), listManualCustomers()]);
    const rows = await aggregateCustomers(bookings, manual);
    const target = rows.find((r) => r.email.toLowerCase() === toEmail);
    const source = rows.find((r) => r.email.toLowerCase() === fromEmail);
    if (!target || !source) {
      return NextResponse.json({ error: "One of those customers no longer exists — refresh and try again." }, { status: 404 });
    }

    const [targetFirst, ...targetRest] = target.name.split(" ");
    const sourceBookings = bookings.filter((b) => b.customer.email.toLowerCase() === fromEmail);
    for (const b of sourceBookings) {
      await updateBookingCustomer(b.id, {
        ...b.customer, // keeps participants and anything else attached
        firstName: targetFirst ?? "",
        lastName: targetRest.join(" "),
        email: target.email,
        phone: target.phone,
        subscribe: target.subscribed,
      });
    }
    // The merged-away record can carry the old system's per-customer totals —
    // sessions and money never itemised as bookings here, legacy credit still
    // owed. Deleting the row would lose them for good, so they move onto the
    // kept customer first (creating a stored record for them if they had none).
    const fromRecord = manual.find((m) => m.email.toLowerCase() === fromEmail);
    if (fromRecord?.imported) {
      const toRecord = manual.find((m) => m.email.toLowerCase() === toEmail);
      await upsertManualCustomer({
        email: target.email,
        firstName: toRecord?.firstName ?? targetFirst ?? "",
        lastName: toRecord?.lastName ?? targetRest.join(" "),
        phone: toRecord?.phone ?? target.phone,
        subscribe: toRecord?.subscribe ?? target.subscribed,
        // The earlier join date: an imported customer has been one since then.
        createdAt: toRecord?.createdAt ?? fromRecord.createdAt,
        imported: toRecord?.imported ? combineImported(toRecord.imported, fromRecord.imported) : fromRecord.imported,
      });
    }
    await deleteManualCustomer(fromEmail);
    await logActivity("Customers merged", `${source.name} (${fromEmail}) → ${target.name} (${target.email}), ${sourceBookings.length} booking(s) moved`);
    return NextResponse.json({ ok: true, moved: sourceBookings.length });
  } catch (err) {
    console.error("merging customers failed:", err);
    return NextResponse.json({ error: "Could not merge right now. Please try again." }, { status: 500 });
  }
}
