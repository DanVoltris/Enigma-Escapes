import { NextRequest, NextResponse } from "next/server";
import { revokeSession, SESSION_COOKIE } from "@/lib/staff";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token).catch(() => {});
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
