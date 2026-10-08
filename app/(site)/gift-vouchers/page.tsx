import GiftVoucherForm from "@/components/GiftVoucherForm";
import { stripeConfigured } from "@/lib/stripe";
import { voucherAmountRules } from "@/lib/voucher-shop";
import { listVoucherProducts } from "@/lib/voucher-products";

export const dynamic = "force-dynamic";

export default async function GiftVouchersPage() {
  // The buyer types what the voucher is worth; the catalogue on the Gift
  // vouchers tab no longer decides what the shop offers. What it may be worth
  // comes from the venue's own prices and taxes (lib/voucher-minimum.ts), so a
  // price change carries through without anyone editing a setting.
  const rules = await voucherAmountRules();
  // Every amount switched off still means "not selling vouchers online", which
  // is how a venue closes the shop.
  const shopOpen = (await listVoucherProducts({ activeOnly: true })).length > 0;
  // With Stripe keys set the card is collected on Stripe's hosted page; without
  // them the form falls back to the same simulated payment as booking.
  return <GiftVoucherForm stripeEnabled={stripeConfigured()} rules={rules} shopOpen={shopOpen} />;
}
