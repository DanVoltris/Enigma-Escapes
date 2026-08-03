import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "@/components/manager/LoginForm";
import { currentStaff } from "@/lib/auth";
import { staffCount } from "@/lib/staff";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Staff sign in — Enigma Escapes",
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const staff = await currentStaff();
  if (staff) redirect(next && next.startsWith("/manager") ? next : "/manager");

  // With no accounts yet, this screen becomes the one-time setup for the first
  // admin (the API refuses once any account exists).
  let firstRun = false;
  try {
    firstRun = (await staffCount()) === 0;
  } catch {
    firstRun = false;
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>{firstRun ? "Set up your admin account" : "Staff sign in"}</h1>
        <p className="card-sub">
          {firstRun
            ? "Nobody has an account yet. Create the owner account — you'll add staff logins afterwards from Settings → Team."
            : "Sign in to the Enigma Escapes staff portal."}
        </p>
        <LoginForm firstRun={firstRun} next={next && next.startsWith("/manager") ? next : "/manager"} />
      </div>
    </div>
  );
}
