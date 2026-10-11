import type { Metadata } from "next";
import SignupForm from "@/components/SignupForm";
import { PLATFORM_DOMAIN } from "@/lib/signup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start your booking site — Voltris Booking",
  robots: { index: false, follow: false },
};

// Where a business creates itself. Lives on the platform's own address, not a
// venue's, so proxy.ts lets it through with no business; the owner then signs
// in at the address they chose.
export default function SignupPage() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Start your booking site</h1>
        <p className="card-sub">
          A few details and your site is ready at an address of your own. You&apos;ll add rooms, prices and session
          times from the staff portal.
        </p>
        <SignupForm domain={PLATFORM_DOMAIN} />
      </div>
    </div>
  );
}
