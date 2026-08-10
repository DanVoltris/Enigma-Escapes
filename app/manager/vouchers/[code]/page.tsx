import Link from "next/link";
import { notFound } from "next/navigation";
import VoucherDetail from "@/components/manager/VoucherDetail";
import { requirePermission } from "@/lib/auth";
import { listExperiences } from "@/lib/experiences";
import { todayISO } from "@/lib/format";
import { getVoucher } from "@/lib/vouchers";

export const dynamic = "force-dynamic";

export default async function VoucherPage({ params }: { params: Promise<{ code: string }> }) {
  await requirePermission("promos", "/manager/vouchers");
  const { code } = await params;
  const voucher = await getVoucher(decodeURIComponent(code));
  if (!voucher) notFound();
  const experiences = await listExperiences({ activeOnly: true });
  const rooms = experiences.map((e) => ({ id: e.id, name: e.name, location: e.location }));

  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href="/manager/vouchers">← Back to gift vouchers</Link>
      </p>
      <h1 className="mgr-page-title">Gift voucher</h1>
      <p className="mgr-page-sub">
        The rules below decide when this voucher can be spent. They&apos;re enforced whenever it&apos;s redeemed, not
        just displayed here.
      </p>
      <VoucherDetail voucher={voucher} rooms={rooms} today={todayISO()} />
    </>
  );
}
