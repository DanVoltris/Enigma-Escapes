import CustomerAccountsForm from "@/components/manager/CustomerAccountsForm";
import { requirePermission } from "@/lib/auth";
import { getBookingPolicies } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function CustomerAccountsPage() {
  await requirePermission("settings", "/manager/settings/customer-accounts");
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
