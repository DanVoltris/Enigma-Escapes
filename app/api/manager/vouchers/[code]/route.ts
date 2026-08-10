import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { logActivity } from "@/lib/db";
import { saveVoucherSettings, setVoucherActive, type VoucherSettings } from "@/lib/vouchers";
import { ALL_DAYS } from "@/lib/voucher-types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function date(v: unknown): string | null {
  return typeof v === "string" && DATE_RE.test(v) ? v : null;
}
function time(v: unknown): string | null {
  return typeof v === "string" && TIME_RE.test(v) ? v : null;
}
function posInt(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

// Activate / deactivate. Deactivating stops a voucher being redeemed without
// deleting it — the record stays for accounting.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const guard = await apiGuard("promos");
  if (guard.response) return guard.response;
  const { code } = await params;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof o.active !== "boolean") {
    return NextResponse.json({ error: "Send whether the voucher should be active (true or false)." }, { status: 400 });
  }
  try {
    const found = await setVoucherActive(decodeURIComponent(code), o.active);
    if (!found) return NextResponse.json({ error: "That voucher code no longer exists." }, { status: 404 });
    await logActivity(o.active ? "Gift voucher activated" : "Gift voucher deactivated", decodeURIComponent(code));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updating gift voucher failed:", err);
    return NextResponse.json({ error: "Could not update that voucher right now. Please try again." }, { status: 500 });
  }
}

// Save the redemption rules from the voucher screen.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const guard = await apiGuard("promos");
  if (guard.response) return guard.response;
  const { code } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  const redemptionType = o.redemptionType === "spaces" ? "spaces" : "value";
  const dateOption = o.dateOption === "range" ? "range" : "any";
  const timeOption = o.timeOption === "range" ? "range" : "any";
  const itemsScope = o.itemsScope === "selected" ? "selected" : "all";

  const days = Array.isArray(o.daysOfWeek)
    ? [...new Set(o.daysOfWeek.filter((d): d is number => typeof d === "number" && ALL_DAYS.includes(d)))].sort()
    : ALL_DAYS;
  if (days.length === 0) {
    return NextResponse.json({ error: "Pick at least one day of the week." }, { status: 400 });
  }
  const itemIds = Array.isArray(o.itemIds) ? o.itemIds.filter((i): i is string => typeof i === "string") : [];
  if (itemsScope === "selected" && itemIds.length === 0) {
    return NextResponse.json({ error: "Choose at least one experience, or apply to all items." }, { status: 400 });
  }

  const dateFrom = date(o.dateFrom);
  const dateTo = date(o.dateTo);
  if (dateOption === "range" && dateFrom && dateTo && dateFrom > dateTo) {
    return NextResponse.json({ error: "The start date must come before the end date." }, { status: 400 });
  }
  const timeFrom = time(o.timeFrom);
  const timeTo = time(o.timeTo);
  if (timeOption === "range" && timeFrom && timeTo && timeFrom > timeTo) {
    return NextResponse.json({ error: "The earliest time must come before the latest time." }, { status: 400 });
  }

  const settings: VoucherSettings = {
    redemptionType,
    spacesTotal: redemptionType === "spaces" ? posInt(o.spacesTotal) : null,
    spacesLeft: redemptionType === "spaces" ? posInt(o.spacesLeft) : null,
    oneTimeUse: o.oneTimeUse === true,
    itemsScope,
    itemIds,
    dateOption,
    dateFrom,
    dateTo,
    timeOption,
    timeFrom,
    timeTo,
    daysOfWeek: days,
    exclusionDates: Array.isArray(o.exclusionDates)
      ? [...new Set(o.exclusionDates.map(date).filter((d): d is string => d !== null))].sort()
      : [],
    expiryDate: date(o.expiryDate),
    active: o.active !== false,
  };

  try {
    const found = await saveVoucherSettings(decodeURIComponent(code), settings);
    if (!found) return NextResponse.json({ error: "That voucher code no longer exists." }, { status: 404 });
    await logActivity("Gift voucher settings updated", decodeURIComponent(code));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("saving gift voucher settings failed:", err);
    return NextResponse.json({ error: "Could not save those settings right now. Please try again." }, { status: 500 });
  }
}
