import PaymentForm from "@/components/PaymentForm";
import { stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// Server wrapper: decides (from environment keys, never exposed) whether the
// client shows real Stripe checkout or the simulated card form.
export default async function PaymentPage({ searchParams }: { searchParams: Promise<{ canceled?: string }> }) {
  const { canceled } = await searchParams;
  return <PaymentForm stripeEnabled={stripeConfigured()} canceled={canceled === "1"} />;
}
