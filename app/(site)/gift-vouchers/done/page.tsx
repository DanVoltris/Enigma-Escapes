import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { retrieveCheckoutSession, stripeConfigured } from "@/lib/stripe";
import { fulfilVoucherSession } from "@/lib/voucher-shop";

export const dynamic = "force-dynamic";

// Where Stripe sends the buyer after a successful payment. The webhook usually
// mints the voucher first; this page issues it too, and the unique index on the
// session id means only one of them ever wins. That way the customer still sees
// their code even if the webhook is slow or misconfigured.
export default async function VoucherDonePage({
  searchParams,
}: {
  searchParams: Promise<{ sid?: string }>;
}) {
  const { sid } = await searchParams;

  let code: string | null = null;
  let amountCents = 0;
  let problem: string | null = null;

  if (!sid || !stripeConfigured()) {
    problem = "We couldn't find that payment.";
  } else {
    try {
      const session = await retrieveCheckoutSession(sid);
      if (session.payment_status !== "paid") {
        problem = "That payment hasn't completed. If you were charged, contact us and we'll sort it out.";
      } else {
        const meta = session.metadata ?? {};
        amountCents = Number(meta.amountCents) || (session.amount_total ?? 0);
        code = await fulfilVoucherSession({
          id: session.id,
          amountCents,
          buyerName: meta.buyerName || "Gift voucher",
          buyerEmail: meta.buyerEmail || "",
          recipientEmail: meta.recipientEmail || null,
          message: meta.message || null,
        });
      }
    } catch (err) {
      console.error("voucher confirmation failed:", err);
      problem = "We couldn't confirm that payment just now. Contact us and we'll look it up.";
    }
  }

  if (!code) {
    return (
      <div className="gv-done">
        <h1 className="page-title">Gift voucher</h1>
        <p>{problem}</p>
        <Link href="/gift-vouchers" className="btn">
          Back to gift vouchers
        </Link>
      </div>
    );
  }

  return (
    <div className="gv-done">
      <h1 className="page-title">Gift voucher ready</h1>
      <p>
        Payment received. Here&apos;s the code — keep it somewhere safe and pass it on to whoever it&apos;s for.
        We&apos;ve got a copy on file, so we can look it up if it goes missing.
      </p>
      <div className="gv-code">{code}</div>
      <p className="gv-worth">Worth {formatMoney(amountCents)} towards any escape room.</p>
      <p className="gv-note">
        It can be spent across more than one visit — whatever&apos;s left stays on the code until it&apos;s used up.
      </p>
      <Link href="/" className="btn">
        Back to booking
      </Link>
    </div>
  );
}
