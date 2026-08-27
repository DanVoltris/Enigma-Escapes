import BoardPage from "@/components/manager/BoardPage";
import NewInvoiceForm from "@/components/manager/NewInvoiceForm";
import { requirePermission } from "@/lib/auth";
import { listExperiences } from "@/lib/experiences";
import { CORPORATE_FEE_CENTS } from "@/lib/pricing";
import { taxSummary } from "@/lib/taxes";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  await requirePermission("bookings.create", "/manager/invoices/new");
  // The invoice quotes one combined rate — the same summary the booking side
  // uses, so an invoice and the booking it becomes agree on the tax.
  const [experiences, tax] = await Promise.all([
    listExperiences().catch(() => []),
    taxSummary().catch(() => ({ percent: 0, label: "Tax" })),
  ]);

  return (
    <>
      <BoardPage />
      <h1 className="mgr-page-title">New invoice</h1>
      <p style={{ color: "var(--text-secondary)" }}>
        For a customer who hasn&apos;t booked yet. Nothing is reserved by raising this — the invoice
        says so, and the session is only held once they pay and you make the booking.
      </p>
      <NewInvoiceForm
        experiences={experiences.map((e) => ({
          id: e.id,
          name: e.name,
          location: e.location,
          priceCents: e.priceCents,
          // The room's own published starts, so the time dropdown offers real
          // sessions rather than a generic clock.
          times: e.times ?? [],
        }))}
        taxPercent={tax.percent}
        taxLabel={tax.label}
        defaultFeeCents={CORPORATE_FEE_CENTS}
      />
    </>
  );
}
