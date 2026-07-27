"use client";

import { useState } from "react";
import Link from "next/link";

export default function FeedbackForm({ initialReference }: { initialReference: string }) {
  const [reference, setReference] = useState(initialReference);
  const [rating, setRating] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (rating < 1) {
      setError("Pick a star rating first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, rating, comment, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not send your feedback. Try again.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your feedback. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="empty-state">
        <h2>Thanks for the feedback!</h2>
        <p>We read every response — see you in the next room.</p>
        <p style={{ marginTop: 16 }}>
          <Link href="/" className="btn">
            Book another game
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form className="form-card" style={{ maxWidth: 560 }} onSubmit={submit} noValidate>
      {error && <div className="error-banner">{error}</div>}
      <div className="field">
        <label htmlFor="fb-ref">
          Booking reference <span className="req">*</span>
        </label>
        <input
          id="fb-ref"
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="VB-AB12CD"
          style={{ maxWidth: 200 }}
        />
        <p className="field-hint">It&apos;s on your confirmation page and text message.</p>
      </div>
      <div className="field">
        <label>
          Your rating <span className="req">*</span>
        </label>
        <div className="fb-stars" role="radiogroup" aria-label="Rating out of 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              className={`fb-star${n <= rating ? " on" : ""}`}
              onClick={() => setRating(n)}
            >
              ★
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="fb-comment">What stood out? (optional)</label>
        <textarea id="fb-comment" rows={4} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className="field" style={{ maxWidth: 280 }}>
        <label htmlFor="fb-name">Your name (optional)</label>
        <input id="fb-name" type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Sending…" : "Send feedback"}
        </button>
      </div>
    </form>
  );
}
