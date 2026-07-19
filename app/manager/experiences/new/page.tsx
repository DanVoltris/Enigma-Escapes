import Link from "next/link";
import ExperienceForm from "@/components/manager/ExperienceForm";

export default function NewExperiencePage() {
  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/experiences">← Back to experiences</Link>
      </p>
      <h1 className="mgr-page-title">Add an experience</h1>
      <p className="mgr-page-sub">Fill this in and it goes live on the booking site as soon as you save.</p>
      <ExperienceForm />
    </>
  );
}
