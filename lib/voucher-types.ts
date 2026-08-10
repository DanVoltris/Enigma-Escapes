// Pure voucher types and maths — no database imports, so client components can
// use these without dragging the server-only Supabase/fs layer into the browser
// bundle. (Same split as site-settings-defaults.ts.)

export type Voucher = {
  code: string;
  faceCents: number; // value when issued
  remainingCents: number; // still spendable
  active: boolean;
  createdAt: string;
  purchaser: string | null; // who bought/created it
  email: string | null;
  message: string | null; // gift message, when one was written
  lastUsedAt: string | null;
};

// Totals for the summary strip. Outstanding balance is what the business still
// owes in unredeemed vouchers — the number worth watching.
export function voucherTotals(vouchers: Voucher[]) {
  let face = 0;
  let outstanding = 0;
  let live = 0;
  for (const v of vouchers) {
    face += v.faceCents;
    if (v.active) {
      outstanding += v.remainingCents;
      if (v.remainingCents > 0) live += 1;
    }
  }
  return { face, outstanding, live, total: vouchers.length };
}
