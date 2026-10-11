import { NextRequest, NextResponse } from "next/server";
import { createBusiness, signupAllowed, signupOffered, signupProblem, type SignupInput } from "@/lib/signup";

export const dynamic = "force-dynamic";

// A business creating itself. Reached on an address that is nobody's — proxy.ts
// lets this path through with no business — and answers with the new site's
// address. Nothing is signed in here: the owner signs in at their own address,
// where the session belongs.
export async function POST(req: NextRequest) {
  if (!signupOffered()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip")?.trim() || "";
  if (!signupAllowed(ip)) {
    return NextResponse.json({ error: "Too many sign-ups from this connection. Try again in an hour." }, { status: 429 });
  }
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  const input: SignupInput = {
    name: str("name"),
    slug: str("slug"),
    ownerName: str("ownerName"),
    email: str("email"),
    password: str("password"),
    timezone: str("timezone"),
  };
  const problem = signupProblem(input);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const { host } = await createBusiness(input);
    return NextResponse.json({ ok: true, host, login: `https://${host}/login` }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create your business right now.";
    const taken = /already taken/.test(message);
    if (!taken) console.error("sign-up failed:", err);
    return NextResponse.json({ error: message }, { status: taken ? 409 : 500 });
  }
}
