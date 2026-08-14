"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm({ firstRun, next }: { firstRun: boolean; next: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(firstRun ? "/api/staff/setup" : "/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(firstRun ? { name, email, password } : { email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not sign in.");
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setBusy(false);
    }
  }

  return (
    <form className="mgr-form" onSubmit={submit} noValidate>
      {error && <div className="error-banner">{error}</div>}
      {firstRun && (
        <div className="field">
          <label htmlFor="lg-name">Your name</label>
          <input id="lg-name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
      )}
      <div className="field">
        <label htmlFor="lg-email">Email or username</label>
        <input
          id="lg-email"
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
      <div className="field">
        <label htmlFor="lg-pw">Password</label>
        <input
          id="lg-pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={firstRun ? "new-password" : "current-password"}
        />
        {firstRun && <p className="field-hint">At least 5 characters. Use something only you know.</p>}
      </div>
      <button type="submit" className="btn" disabled={busy}>
        {busy ? "Please wait…" : firstRun ? "Create admin account" : "Sign in"}
      </button>
    </form>
  );
}
