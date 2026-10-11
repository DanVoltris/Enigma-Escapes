import { NextRequest, NextResponse } from "next/server";
import { PLATFORM_DOMAIN, signupOffered, slugAvailable, slugProblem } from "@/lib/signup";

export const dynamic = "force-dynamic";

// The live check as a web address is typed on the sign-up form.
export async function GET(req: NextRequest) {
  if (!signupOffered()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const slug = (req.nextUrl.searchParams.get("slug") ?? "").trim().toLowerCase();
  const problem = slugProblem(slug);
  if (problem) return NextResponse.json({ ok: false, problem }, { headers: { "Cache-Control": "no-store" } });
  try {
    const available = await slugAvailable(slug);
    return NextResponse.json(
      { ok: available, host: `${slug}.${PLATFORM_DOMAIN}`, ...(available ? {} : { problem: "That web address is already taken." }) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("slug check failed:", err);
    return NextResponse.json({ ok: false, problem: "Couldn't check that address just now." }, { status: 503 });
  }
}
