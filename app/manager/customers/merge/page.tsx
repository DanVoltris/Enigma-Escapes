import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import MergeCustomersForm from "@/components/manager/MergeCustomersForm";
import { aggregateCustomers, listManualCustomers } from "@/lib/customers";
import { listBookings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MergeCustomersPage() {
  await requirePermission("customers.view", "/manager/customers/merge");
  const [bookings, manual] = await Promise.all([listBookings(), listManualCustomers()]);
  const rows = await aggregateCustomers(bookings, manual);
  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/customers">← Back to all customers</Link>
      </p>
      <h1 className="mgr-page-title">Merge customers</h1>
      <p className="mgr-page-sub">
        For when one person ended up as two contacts (usually an email typo): pick who to keep, and the duplicate&apos;s
        bookings are rewritten onto them.
      </p>
      <MergeCustomersForm customers={rows.map((r) => ({ name: r.name, email: r.email, bookings: r.bookings }))} />
    </>
  );
}
