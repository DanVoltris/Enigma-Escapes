"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddCustomerForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subscribe, setSubscribe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, phone, subscribe }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not save the customer.");
      router.push("/manager/customers");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the customer.");
      setSaving(false);
    }
  }

  return (
    <form className="form-card mgr-form" style={{ maxWidth: 640 }} onSubmit={submit} noValidate>
      {error && <div className="error-banner">{error}</div>}
      <div className="field-row">
        <div className="field">
          <label htmlFor="nc-fn">First name</label>
          <input id="nc-fn" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nc-ln">Last name</label>
          <input id="nc-ln" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="nc-em">Email</label>
          <input id="nc-em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nc-ph">Phone (optional)</label>
          <input id="nc-ph" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <label className="intg-toggle">
        <input type="checkbox" checked={subscribe} onChange={(e) => setSubscribe(e.target.checked)} />
        Subscribed to marketing
      </label>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Saving…" : "Add customer"}
        </button>
      </div>
    </form>
  );
}
