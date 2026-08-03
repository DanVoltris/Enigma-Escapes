import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import AddCustomerForm from "@/components/manager/AddCustomerForm";

export default async function NewCustomerPage() {
  await requirePermission("customers.view", "/manager/customers/new");
  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/customers">← Back to all customers</Link>
      </p>
      <h1 className="mgr-page-title">Add customer</h1>
      <p className="mgr-page-sub">
        Add someone before their first booking — a phone enquiry, a gift recipient, a mailing-list signup. They&apos;ll
        appear on the Customers tab and in the walk-in booking lookup right away.
      </p>
      <AddCustomerForm />
    </>
  );
}
