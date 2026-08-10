import GiftVoucherForm from "@/components/GiftVoucherForm";
import { stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export default function GiftVouchersPage() {
  // With Stripe keys set the card is collected on Stripe's hosted page; without
  // them the form falls back to the same simulated payment as booking.
  return <GiftVoucherForm stripeEnabled={stripeConfigured()} />;
}
