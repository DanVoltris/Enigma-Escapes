import type { Metadata } from "next";
import { getBusinessDetails, getCompanyName } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `Privacy policy — ${await getCompanyName()}` };
}

// Written from what the system actually does, not from a template, and kept
// honest by saying so where a feature isn't switched on. When what we collect
// changes — the Pixel goes live, card payments move online, the events table
// starts holding something new — this page changes with it, and the date at
// the bottom moves.
const UPDATED = "September 8, 2026";

export default async function PrivacyPage() {
  const [company, business] = await Promise.all([
    getCompanyName(),
    getBusinessDetails().then((r) => r.value).catch(() => null),
  ]);
  const email = business?.email || "info@enigmaescapes.com";
  const phone = business?.phone || business?.cell || "";
  const address = business?.address?.trim() || "";

  return (
    <>
      <h1 className="page-title">Privacy policy</h1>
      <p className="page-subtitle">How {company} handles what you tell us when you book.</p>

      <div className="form-card policy-page" style={{ maxWidth: 720 }}>
        <h3>What we collect when you book</h3>
        <p>
          Your name, email address and phone number, the names of anyone you add to the booking, and the details of
          the session itself. We need these to run your game and to reach you about it.
        </p>

        <h3>What we do with it</h3>
        <p>
          We use your details to confirm your booking, send you a text with your booking link, and contact you if
          your session changes. If you tick the box at checkout, we&apos;ll also email you promotions and news — you
          can ask us to stop at any time. We never sell your details.
        </p>

        <h3>Payment</h3>
        <p>
          When card payments run through Stripe, your card details go to Stripe and never touch our systems. We keep
          a record that a payment happened, not the card. Card payments are currently handled at the venue.
        </p>

        <h3>Who else sees your details</h3>
        <p>
          Texts are sent through Twilio. Nobody outside {company} and the services that send those messages gets
          your name, email or phone number. Photo and booking partners see session times, never who booked them.
        </p>

        <h3>How we use the website</h3>
        <p>
          We keep a simple record of how people use the booking site — which dates and rooms people looked for, and
          how far through booking they got — so we can open the right rooms at the right times. This uses a random
          identifier stored in your browser; it is not linked to your name unless you complete a booking. We also
          note where a booking came from (for example, a link in a post) so we know which promotions work. We keep
          this usage data for 180 days.
        </p>

        <h3>Advertising tools</h3>
        <p>
          We do not currently use any third-party advertising or analytics tools such as the Meta Pixel or Google
          Tag Manager on this site. If that changes, this policy will say so and you&apos;ll be able to decline
          them.
        </p>

        <h3>Cookies and storage</h3>
        <p>
          Your browser holds your cart while you book, the random identifier above, and — if you&apos;re staff —
          your login. That&apos;s all.
        </p>

        <h3>How long we keep bookings</h3>
        <p>
          Booking records are kept so we can honour gift vouchers, handle refunds and recognise returning guests.
          Ask us and we&apos;ll delete what we hold about you, except where we need to keep a record for tax or
          refund purposes.
        </p>

        <h3>Your rights</h3>
        <p>
          You can ask what we hold about you, correct it, or have it deleted. Email{" "}
          <a href={`mailto:${email}`}>{email}</a>
          {phone && (
            <>
              {" "}
              or call <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a>
            </>
          )}
          {address && <>, or write to us at {address}</>}.
        </p>

        <h3>Changes</h3>
        <p>We&apos;ll update this page if what we collect changes. Last updated: {UPDATED}.</p>
      </div>
    </>
  );
}
