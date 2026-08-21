// What happens to reward codes at the two moments that matter: a booking being
// confirmed, and a booking being cancelled.
//
// Kept apart from lib/reward-codes.ts (which only talks to the table) so the
// table layer stays free of SMS and booking-repricing concerns, and apart from
// lib/db.ts so there's no import cycle through the SMS module.
import { addBookingNote, getBooking, logActivity, updateBookingFields } from "./db";
import { computeTotals } from "./pricing";
import { getPricingMode } from "./pricing-settings";
import { markRewardUsed, mintRewardFor, revokeRewardFor } from "./reward-codes";
import { notifyRewardCode } from "./sms";
import { activeTaxPercent } from "./taxes";
import type { Booking } from "./types";

// Runs when a booking is confirmed and paid for. Spends the reward the
// customer used, and mints + texts the one this booking earns.
//
// Every step is best-effort: a confirmed booking must never be undone because
// a text failed or a code couldn't be written.
export async function settleRewardsFor(booking: Booking): Promise<void> {
  const spent = booking.pricing.rewardCode;
  if (spent) {
    try {
      // Conditional on the code still being active, so the Stripe webhook and
      // the return page racing this can't spend it twice.
      await markRewardUsed(spent, booking.id);
    } catch (err) {
      console.error(`could not mark reward ${spent} used on ${booking.reference}:`, err);
    }
  }

  // A booking bought with a reward doesn't earn another one. Otherwise the
  // chain never breaks and a repeat customer pays 20% less forever.
  if (spent) return;

  // Nor does a corporate event. The 20% code is a nudge for an individual to
  // come back for another game; handing one to a company that just booked out
  // three rooms discounts the next corporate event by hundreds of dollars, and
  // it would be texted to whoever's name happened to be on the booking.
  if (booking.pricing.corporate) return;

  try {
    const minted = await mintRewardFor(booking);
    if (minted?.created) {
      await notifyRewardCode(booking, minted.reward.code, minted.reward.percentOff, minted.reward.validUntil);
      await logActivity(
        "Reward code issued",
        `${booking.reference} — ${minted.reward.code} (${minted.reward.percentOff}% off the next booking)`
      );
    }
  } catch (err) {
    console.error(`could not issue a reward for ${booking.reference}:`, err);
  }
}

// Runs when a booking is cancelled. The reward it earned dies with it — and if
// that reward has already been spent, the booking it was spent on goes back to
// full price. Otherwise cancelling the first visit would be a way to keep a
// discount that was only ever offered for staying booked.
//
// Returns a short description of what happened, or null when there was no
// reward involved, so the caller can mention it to staff.
export async function revokeRewardsFor(booking: Booking): Promise<string | null> {
  let revoked;
  try {
    revoked = await revokeRewardFor(booking.id);
  } catch (err) {
    console.error(`could not revoke the reward earned by ${booking.reference}:`, err);
    return null;
  }
  if (!revoked) return null;

  await logActivity(
    "Reward code revoked",
    `${booking.reference} cancelled — ${revoked.code} is no longer valid`
  );

  // Unspent: nothing else to do, the code simply stops working.
  if (!revoked.usedBooking) return `Reward code ${revoked.code} cancelled with it.`;

  try {
    const affected = await getBooking(revoked.usedBooking);
    if (!affected || affected.status === "cancelled") return `Reward code ${revoked.code} cancelled with it.`;

    // Re-price at full: same sessions, no discount. balanceCents is always
    // total - paid, so the money now owed shows up by itself on the Today
    // board, the Bookings list and the booking's own Total due.
    const totals = computeTotals(
      affected.items,
      0,
      await activeTaxPercent(),
      await getPricingMode(),
      affected.pricing.flatFeeCents ?? 0
    );
    const extraCents = totals.totalCents - affected.pricing.totalCents;
    if (extraCents <= 0) return `Reward code ${revoked.code} cancelled with it.`;

    await updateBookingFields(affected.id, {
      pricing: {
        ...affected.pricing,
        subtotalCents: totals.subtotalCents,
        discountCents: 0,
        gstCents: totals.gstCents,
        totalCents: totals.totalCents,
        balanceCents: totals.totalCents - affected.pricing.paidCents,
        rewardVoidedAt: new Date().toISOString(),
        rewardOwedCents: extraCents,
      },
    });

    const money = `$${(extraCents / 100).toFixed(2)}`;
    await addBookingNote(
      affected.id,
      `The ${revoked.code} discount was taken off this booking because the booking that earned it (${booking.reference}) was cancelled. This booking is back at full price — collect ${money} from the customer.`
    );
    await logActivity(
      "Discount voided — payment owed",
      `${affected.reference} — ${money} to collect after ${booking.reference} was cancelled`
    );
    return `${affected.reference} is back at full price — ${money} to collect.`;
  } catch (err) {
    console.error(`could not re-price the booking that used ${revoked.code}:`, err);
    return `Reward code ${revoked.code} cancelled with it — check ${revoked.usedBooking} manually.`;
  }
}
