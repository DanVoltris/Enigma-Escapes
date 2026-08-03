import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import {
  createStaff,
  defaultPermissionsFor,
  passwordProblem,
  SESSION_COOKIE,
  signIn,
  staffCount,
} from "@/lib/staff";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One-time bootstrap: creates the FIRST admin account and signs them in.
// Refuses the moment any account exists, so it can't be used to add a second
// admin later — after this, accounts are created from Settings → Team.
export async function POST(req: NextRequest) {
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
  const email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
  const password = typeof o.password === "string" ? o.password : "";

  try {
    if ((await staffCount()) > 0) {
      return NextResponse.json(
        { error: "Setup is already complete — sign in instead." },
        { status: 403 }
      );
    }
  } catch (err) {
    console.error("setup precheck failed:", err);
    return NextResponse.json({ error: "Could not reach the database. Try again shortly." }, { status: 500 });
  }

  if (!name) return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    await createStaff({
      email,
      name,
      password,
      role: "admin",
      locations: [], // every location
      permissions: defaultPermissionsFor("admin"),
    });
    await logActivity("Staff portal set up", `First admin: ${name}`);
    const result = await signIn(email, password);
    const res = NextResponse.json({ ok: true }, { status: 201 });
    if (result) {
      res.cookies.set(SESSION_COOKIE, result.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
      });
    }
    return res;
  } catch (err) {
    console.error("creating first admin failed:", err);
    const msg = err instanceof Error ? err.message : "Could not create the account. Please try again.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
