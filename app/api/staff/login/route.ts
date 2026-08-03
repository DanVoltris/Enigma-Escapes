import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import { SESSION_COOKIE, signIn } from "@/lib/staff";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof o.email === "string" ? o.email : "";
  const password = typeof o.password === "string" ? o.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  try {
    const result = await signIn(email, password);
    // One message for every failure — never reveal whether the email exists.
    if (!result) {
      return NextResponse.json({ error: "That email and password don't match an active account." }, { status: 401 });
    }
    await logActivity("Staff signed in", result.staff.name);
    const res = NextResponse.json({ ok: true, name: result.staff.name });
    res.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return res;
  } catch (err) {
    console.error("staff login failed:", err);
    return NextResponse.json({ error: "Could not sign you in right now. Please try again." }, { status: 500 });
  }
}
