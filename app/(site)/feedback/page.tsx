import FeedbackForm from "@/components/FeedbackForm";

export const dynamic = "force-dynamic";

// Public post-game survey; usually reached from the confirmation page link
// (which pre-fills the booking reference).
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  return (
    <>
      <h1 className="page-title">How was your game?</h1>
      <p className="page-subtitle">Two quick questions — it helps us make the rooms better.</p>
      <FeedbackForm initialReference={typeof ref === "string" ? ref : ""} />
    </>
  );
}
