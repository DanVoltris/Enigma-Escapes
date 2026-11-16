// How a promo code's discount reads wherever it's shown: "16.69% off" or
// "$20.00 off". A dollar code has percentOff 0, so printing the percentage
// alone would show it as "0% off".
import { formatMoney } from "./format";

export function promoOffLabel(p: { percentOff: number; amountOffCents?: number }): string {
  return p.amountOffCents && p.amountOffCents > 0 ? `${formatMoney(p.amountOffCents)} off` : `${p.percentOff}% off`;
}
