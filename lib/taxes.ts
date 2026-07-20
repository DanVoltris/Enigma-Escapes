import { randomUUID } from "crypto";
import { rest, restError } from "./supabase";
import type { Tax } from "./types";

type TaxRow = { id: string; name: string; percent: number | string; active: boolean; sort: number };

function toTax(r: TaxRow): Tax {
  return { id: r.id, name: r.name, percent: Number(r.percent), active: r.active, sort: r.sort };
}

export async function listTaxes(): Promise<Tax[]> {
  const res = await rest("taxes?select=*&order=sort.asc,name.asc");
  if (!res.ok) throw await restError(res, "Loading taxes");
  return ((await res.json()) as TaxRow[]).map(toTax);
}

// Combined percentage of all active taxes (non-compound: simple sum).
export async function activeTaxPercent(): Promise<number> {
  const taxes = await listTaxes();
  return taxes.filter((t) => t.active).reduce((sum, t) => sum + t.percent, 0);
}

// A short label for the tax line, e.g. "GST" or "Taxes" when there are several.
export async function taxSummary(): Promise<{ percent: number; label: string }> {
  const active = (await listTaxes()).filter((t) => t.active);
  const percent = active.reduce((sum, t) => sum + t.percent, 0);
  const label = active.length === 1 ? active[0].name : "Taxes";
  return { percent, label };
}

export async function createTax(name: string, percent: number): Promise<void> {
  const all = await listTaxes();
  const sort = Math.max(0, ...all.map((t) => t.sort)) + 1;
  const res = await rest("taxes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ id: randomUUID(), name, percent, active: true, sort }),
  });
  if (!res.ok) throw await restError(res, "Creating the tax");
}

export async function updateTax(id: string, patch: { name?: string; percent?: number; active?: boolean }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.percent !== undefined) row.percent = patch.percent;
  if (patch.active !== undefined) row.active = patch.active;
  const res = await rest(`taxes?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw await restError(res, "Updating the tax");
}

export async function deleteTax(id: string): Promise<void> {
  const res = await rest(`taxes?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (!res.ok) throw await restError(res, "Removing the tax");
}
