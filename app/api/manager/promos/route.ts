import { NextRequest, NextResponse } from "next/server";
import { createPromo, getPromo } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const d = body as { code?: unknown; percentOff?: unknown };

  const code = typeof d.code === "string" ? d.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{3,40}$/.test(code)) {
    return NextResponse.json(
      { error: "Codes are 3–40 letters and numbers, no spaces — e.g. SUMMER20." },
      { status: 400 }
    );
  }
  const percentOff = Number(d.percentOff);
  if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) {
    return NextResponse.json({ error: "Discount must be a whole number from 1 to 100 percent." }, { status: 400 });
  }

  try {
    if (await getPromo(code)) {
      return NextResponse.json({ error: `${code} already exists. Edit it in the list instead.` }, { status: 409 });
    }
    await createPromo({ code, percentOff, active: true });
    return NextResponse.json({ code }, { status: 201 });
  } catch (err) {
    console.error("creating promo failed:", err);
    return NextResponse.json(
      { error: "Could not save the code right now. Please try again shortly." },
      { status: 500 }
    );
  }
}
