import { NextResponse } from "next/server";
import { databaseMode, rest } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Is this venue reaching its database, and how? For checking a deployment —
// above all a venue switched to tenant mode — without logging in and without
// touching anything a report counts (availability records a "look" per call).
//
// It reads the tenants table. In tenant mode the policy there shows a business
// only its own row, so exactly one row proves three things at once: the signed
// token was accepted, it switched to tenant_app, and VENUE_TENANT_ID names a
// business that exists. Says nothing identifying — no ids, no names.
export async function GET() {
  const noStore = { "Cache-Control": "no-store" };
  let mode: ReturnType<typeof databaseMode>;
  try {
    mode = databaseMode();
  } catch (err) {
    // The message names settings, never their values (lib/tenant-token.ts).
    return NextResponse.json(
      { ok: false, database: "misconfigured", reason: (err as Error).message },
      { status: 503, headers: noStore }
    );
  }
  if (mode === "local") return NextResponse.json({ ok: true, database: "local" }, { headers: noStore });

  try {
    const res = await rest("tenants?select=id&limit=2");
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      return NextResponse.json(
        { ok: false, database: mode, status: res.status, code: body.code ?? null },
        { status: 503, headers: noStore }
      );
    }
    const rows = (await res.json()) as unknown[];
    const ok = mode === "tenant" ? rows.length === 1 : rows.length >= 1;
    return NextResponse.json({ ok, database: mode, ...(ok ? {} : { rows: rows.length }) }, { status: ok ? 200 : 503, headers: noStore });
  } catch {
    return NextResponse.json({ ok: false, database: mode, status: "unreachable" }, { status: 503, headers: noStore });
  }
}
