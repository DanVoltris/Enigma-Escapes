"use client";

import { useEffect, useRef, useState } from "react";
import SingleSelect from "@/components/SingleSelect";
import { timezoneOptions } from "@/lib/locale-options";
import { slugFromName, slugProblem } from "@/lib/signup-rules";

type SlugState = { kind: "idle" } | { kind: "checking" } | { kind: "ok"; host: string } | { kind: "bad"; problem: string };

export default function SignupForm({ domain }: { domain: string }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<SlugState>({ kind: "idle" });
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Winnipeg";
    } catch {
      return "America/Winnipeg";
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ host: string; login: string } | null>(null);
  const timezones = useRef(timezoneOptions()).current;

  // The address follows the name until the owner edits it themselves.
  useEffect(() => {
    if (!slugTouched) setSlug(slugFromName(name));
  }, [name, slugTouched]);

  // Check the address as it settles, not on every keystroke.
  useEffect(() => {
    const problem = slugProblem(slug);
    if (!slug) {
      setSlugState({ kind: "idle" });
      return;
    }
    if (problem) {
      setSlugState({ kind: "bad", problem });
      return;
    }
    setSlugState({ kind: "checking" });
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/signup/slug?slug=${encodeURIComponent(slug)}`, { signal: ctrl.signal });
        const data = (await res.json()) as { ok: boolean; host?: string; problem?: string };
        setSlugState(data.ok && data.host ? { kind: "ok", host: data.host } : { kind: "bad", problem: data.problem ?? "That address isn't available." });
      } catch {
        if (!ctrl.signal.aborted) setSlugState({ kind: "idle" });
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, ownerName, email, password, timezone }),
      });
      const data = (await res.json()) as { ok?: boolean; host?: string; login?: string; error?: string };
      if (!res.ok || !data.ok || !data.host || !data.login) throw new Error(data.error ?? "Could not create your business.");
      setDone({ host: data.host, login: data.login });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your business.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="signup-done" role="status">
        <h2>Your booking site is ready</h2>
        <p>
          Customers will book at <strong>{done.host}</strong>. Sign in there with the email and password you just chose,
          then add your rooms under Experiences.
        </p>
        <a className="btn" href={done.login}>
          Go to your staff portal
        </a>
      </div>
    );
  }

  return (
    <form className="mgr-form" onSubmit={submit} noValidate>
      {error && <div className="error-banner">{error}</div>}
      <div className="field">
        <label htmlFor="su-name">Business name</label>
        <input id="su-name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" maxLength={80} />
      </div>
      <div className="field">
        <label htmlFor="su-slug">Web address</label>
        <div className="signup-slug">
          <input
            id="su-slug"
            type="text"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            autoCapitalize="none"
            spellCheck={false}
            maxLength={63}
            aria-describedby="su-slug-state"
          />
          <span className="signup-domain">.{domain}</span>
        </div>
        <p id="su-slug-state" className={`field-hint${slugState.kind === "bad" ? " field-hint-bad" : ""}`} aria-live="polite">
          {slugState.kind === "idle" && "Lower-case letters, numbers and hyphens."}
          {slugState.kind === "checking" && "Checking…"}
          {slugState.kind === "ok" && `Available — your site will be ${slugState.host}`}
          {slugState.kind === "bad" && slugState.problem}
        </p>
      </div>
      <div className="field">
        <label htmlFor="su-tz">Timezone</label>
        <SingleSelect value={timezone} options={timezones} onChange={setTimezone} ariaLabel="Timezone" />
        <p className="field-hint">Session times are shown in this timezone. You can change it later in Settings.</p>
      </div>
      <div className="field">
        <label htmlFor="su-owner">Your name</label>
        <input id="su-owner" type="text" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} autoComplete="name" maxLength={80} />
      </div>
      <div className="field">
        <label htmlFor="su-email">Email you&apos;ll sign in with</label>
        <input id="su-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} />
      </div>
      <div className="field">
        <label htmlFor="su-pw">Password</label>
        <input id="su-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        <p className="field-hint">At least 5 characters. Use something only you know.</p>
      </div>
      <button type="submit" className="btn" disabled={busy || slugState.kind === "checking" || slugState.kind === "bad"}>
        {busy ? "Creating your site…" : "Create my booking site"}
      </button>
    </form>
  );
}
