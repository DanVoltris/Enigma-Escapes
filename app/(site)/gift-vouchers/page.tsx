import GiftVoucherForm from "@/components/GiftVoucherForm";
import { stripeConfigured } from "@/lib/stripe";
import { listVoucherProducts } from "@/lib/voucher-products";

export const dynamic = "force-dynamic";

export default async function GiftVouchersPage() {
  // Only what's switched on in the Gift vouchers tab is offered for sale.
  const products = (await listVoucherProducts({ activeOnly: true })).map((p) => ({
    cents: p.amountCents,
    name: p.name,
  }));
  // With Stripe keys set the card is collected on Stripe's hosted page; without
  // them the form falls back to the same simulated payment as booking.
  return <GiftVoucherForm stripeEnabled={stripeConfigured()} products={products} />;
}
