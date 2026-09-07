import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/db";
import { clearLoginFailures, loginLock, recordLoginFailure } from "@/lib/login-throttle";
import { SESSION_COOKIE, signIn } from "@/lib/staff";

export const dynamic = "force-dynamic";

// The caller's address, as the proxy in front of us reports it. Vercel sets
// x-forwarded-for; the first entry is the client, the rest are hops.
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() ?? "";
}

export async function POST(req: NextRequest) {
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof o.email === "string" ? o.email : "";
  const password = typeof o.password === "string" ? o.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your login and password." }, { status: 400 });
  }

  try {
    // Too many recent failures on this login: refuse without checking the
    // password at all, so guessing costs an attacker the full lockout.
    const ip = clientIp(req);
    const lock = await loginLock(email, ip);
    if (lock.locked) {
      return NextResponse.json(
        {
          error: `Too many failed sign-in attempts. Try again in ${lock.minutesLeft} minute${
            lock.minutesLeft === 1 ? "" : "s"
          }.`,
        },
        { status: 429 }
      );
    }

    const result = await signIn(email, password);
    // One message for every failure — never reveal whether the account exists.
    if (!result) {
      await recordLoginFailure(email, ip);
      return NextResponse.json({ error: "That login and password don't match an active account." }, { status: 401 });
    }
    await clearLoginFailures(email, ip);
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
