import CustomerAccountsForm from "@/components/manager/CustomerAccountsForm";
import { getBookingPolicies } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function CustomerAccountsPage() {
  const policies = await getBookingPolicies();
  return (
    <>
      <p className="mgr-page-sub" style={{ marginBottom: 20 }}>
        Customers book as guests (no logins yet), so this manages the reschedule and cancellation <strong>policies</strong>{" "}
        shown on their confirmation page — not self-service actions.
      </p>
      <CustomerAccountsForm initial={policies} />
    </>
  );
}
