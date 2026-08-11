// The gift-voucher catalogue: what customers can buy. Distinct from
// gift_vouchers, which holds the individual codes that have been issued —
// this is the product list behind them, managed on the Gift vouchers tab.
import { randomUUID } from "crypto";
import { rest, restError } from "./supabase";

export type VoucherProduct = {
  id: string;
  name: string;
  amountCents: number;
  description: string | null;
  active: boolean;
  sortOrder: number;
};

type Row = {
  id: string;
  name: string;
  amount_cents: number;
  description: string | null;
  active: boolean;
  sort_order: number;
};

function toProduct(r: Row): VoucherProduct {
  return {
    id: r.id,
    name: r.name,
    amountCents: r.amount_cents,
    description: r.description,
    active: r.active,
    sortOrder: r.sort_order,
  };
}

export async function listVoucherProducts(opts?: { activeOnly?: boolean }): Promise<VoucherProduct[]> {
  const filter = opts?.activeOnly ? "&active=is.true" : "";
  const res = await rest(`voucher_products?select=*${filter}&order=amount_cents.asc`);
  if (!res.ok) throw await restError(res, "Loading gift voucher products");
  return ((await res.json()) as Row[]).map(toProduct);
}

// Only an ACTIVE product can be bought — switching one off takes it off sale
// immediately, which is the point of the toggle.
export async function isOnSale(amountCents: number): Promise<boolean> {
  const res = await rest(`voucher_products?amount_cents=eq.${amountCents}&active=is.true&select=id&limit=1`);
  if (!res.ok) throw await restError(res, "Checking that voucher product");
  return ((await res.json()) as unknown[]).length > 0;
}

export async function getProductByAmount(amountCents: number): Promise<VoucherProduct | undefined> {
  const res = await rest(`voucher_products?amount_cents=eq.${amountCents}&select=*&limit=1`);
  if (!res.ok) throw await restError(res, "Loading that voucher product");
  const rows = (await res.json()) as Row[];
  return rows[0] ? toProduct(rows[0]) : undefined;
}

// Returns null when a product for that amount already exists — one product per
// amount keeps the shop list unambiguous.
export async function createVoucherProduct(input: {
  name: string;
  amountCents: number;
  description: string | null;
}): Promise<VoucherProduct | null> {
  if (await getProductByAmount(input.amountCents)) return null;
  const row = {
    id: randomUUID(),
    name: input.name,
    amount_cents: input.amountCents,
    description: input.description,
    active: true,
    sort_order: input.amountCents,
    created_at: new Date().toISOString(),
  };
  const res = await rest("voucher_products", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (res.status === 409) return null;
  if (!res.ok) throw await restError(res, "Creating that voucher product");
  const rows = (await res.json()) as Row[];
  return rows[0] ? toProduct(rows[0]) : null;
}

export async function updateVoucherProduct(
  id: string,
  patch: { name?: string; description?: string | null; active?: boolean }
): Promise<boolean> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.active !== undefined) body.active = patch.active;
  if (Object.keys(body).length === 0) return true;

  const res = await rest(`voucher_products?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await restError(res, "Updating that voucher product");
  return ((await res.json()) as Row[]).length > 0;
}

// Deleting a product never touches vouchers already issued at that amount —
// those are real balances customers hold. It only takes it off the catalogue.
export async function deleteVoucherProduct(id: string): Promise<boolean> {
  const res = await rest(`voucher_products?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (!res.ok) throw await restError(res, "Removing that voucher product");
  return ((await res.json()) as Row[]).length > 0;
}

export type ProductStats = { issued: number; spent: number; valueCents: number };

// Per-product sales figures, read off the issued codes: how many exist at that
// amount, how many are fully spent, and their combined face value.
export function statsFor(
  products: VoucherProduct[],
  vouchers: { faceCents: number; remainingCents: number }[]
): Map<number, ProductStats> {
  const out = new Map<number, ProductStats>();
  for (const p of products) out.set(p.amountCents, { issued: 0, spent: 0, valueCents: 0 });
  for (const v of vouchers) {
    const s = out.get(v.faceCents);
    if (!s) continue;
    s.issued += 1;
    s.valueCents += v.faceCents;
    if (v.remainingCents <= 0) s.spent += 1;
  }
  return out;
}
