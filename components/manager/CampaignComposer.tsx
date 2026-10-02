"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ConfirmDialog";
import SingleSelect from "@/components/SingleSelect";
import { campaignText, segmentsFor } from "@/lib/campaign-text";
import { CONSENT_MONTHS, type CampaignFilters } from "@/lib/campaign-filters";

type Preview = {
  recipients: number;
  optedOut: number;
  sample: { name: string | null; phone: string; lastBooked: string | null }[];
  preview: string;
  segments: number;
  unicode: boolean;
  characters: number;
};

// Roughly what Twilio charges per text segment in Canada. Only ever shown as
// "about", because the real figure depends on the account's rate.
const CENTS_PER_SEGMENT = 1.1;

export default function CampaignComposer({
  company,
  locations,
  areaCodes,
  myPhone,
  smsReady,
}: {
  company: string;
  locations: string[];
  areaCodes: { code: string; people: number }[];
  myPhone: string | null;
  smsReady: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [months, setMonths] = useState<number | null>(CONSENT_MONTHS);
  const [includeSubscribers, setIncludeSubscribers] = useState(true);
  const [pickedAreas, setPickedAreas] = useState<string[]>([]);
  const [pickedLocations, setPickedLocations] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [testPhone, setTestPhone] = useState(myPhone ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const filters: CampaignFilters = { months, includeSubscribers, areaCodes: pickedAreas, locations: pickedLocations };
  const shown = campaignText(company, body || "Your message goes here.");
  const { segments, unicode, characters } = segmentsFor(shown);
  const beyondConsent = months === null || months > CONSENT_MONTHS;

  async function call<T>(key: string, url: string, method: string, payload: unknown): Promise<T | null> {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "That didn't work.");
      return data as T;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  const toggle = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const cost = preview ? (preview.recipients * segments * CENTS_PER_SEGMENT) / 100 : 0;
  const minutes = preview ? Math.ceil(preview.recipients / 60) : 0;

  return (
    <>
      <div className="mgr-card">
        <h2>New campaign</h2>
        <p className="card-sub">
          A text to customers. Everyone who has bought from you in the last {CONSENT_MONTHS} months may be texted;
          beyond that you need their say-so. Every message carries your name and &ldquo;Reply STOP to stop&rdquo;,
          and anyone who has stopped is left out automatically.
        </p>

        {!smsReady && (
          <p className="card-sub warn">
            Texting isn&apos;t set up for this venue yet, so nothing can be sent. The Twilio keys go in the site&apos;s
            settings on Vercel.
          </p>
        )}
        {error && <div className="error-banner">{error}</div>}
        {notice && <p className="promo-note ok">{notice}</p>}

        <div className="mgr-form">
          <div className="field" style={{ maxWidth: 420 }}>
            <label htmlFor="c-name">Campaign name</label>
            <input
              id="c-name"
              type="text"
              value={name}
              placeholder="Halloween 2026"
              onChange={(e) => setName(e.target.value)}
            />
            <p className="field-hint">For your records — customers never see this.</p>
          </div>

          <div className="field">
            <label htmlFor="c-body">Message</label>
            <textarea
              id="c-body"
              rows={4}
              value={body}
              placeholder="Halloween nights are on. Book your room before they go."
              onChange={(e) => {
                setBody(e.target.value);
                setPreview(null);
              }}
            />
            <p className="field-hint">
              {characters} characters · {segments} segment{segments === 1 ? "" : "s"} each
              {unicode && " · uses characters that cost more per text"}
            </p>
          </div>

          <div className="campaign-preview">
            <span className="label">What arrives on the phone</span>
            <p>{shown}</p>
          </div>

          <h3 className="intg-subhead">Who gets it</h3>
          <div className="field" style={{ maxWidth: 420 }}>
            <label>Booked in the last</label>
            <SingleSelect
              ariaLabel="Booked in the last"
              value={months === null ? "all" : String(months)}
              onChange={(v) => {
                setMonths(v === "all" ? null : Number(v));
                setPreview(null);
              }}
              options={[
                { value: "3", label: "3 months" },
                { value: "6", label: "6 months" },
                { value: "12", label: "12 months" },
                { value: "24", label: "24 months — everyone you may text" },
                { value: "all", label: "Any time — including customers from years ago" },
              ]}
            />
          </div>
          {beyondConsent && (
            <p className="card-sub warn">
              Customers who last booked more than {CONSENT_MONTHS} months ago haven&apos;t given you permission to
              text them. Sending to them is your call and your risk.
            </p>
          )}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeSubscribers}
              onChange={(e) => {
                setIncludeSubscribers(e.target.checked);
                setPreview(null);
              }}
            />
            <span>Also everyone who ticked &ldquo;keep me posted&rdquo; when booking, whenever that was</span>
          </label>

          {areaCodes.length > 1 && (
            <div className="field">
              <label>Area codes</label>
              <div className="team-locs">
                {areaCodes.map((a) => (
                  <label key={a.code} className="intg-toggle" style={{ fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={pickedAreas.includes(a.code)}
                      onChange={() => {
                        toggle(pickedAreas, a.code, setPickedAreas);
                        setPreview(null);
                      }}
                    />
                    {a.code} ({a.people})
                  </label>
                ))}
              </div>
              <p className="field-hint">None ticked means every area code.</p>
            </div>
          )}

          {locations.length > 1 && (
            <div className="field">
              <label>Booked at</label>
              <div className="team-locs">
                {locations.map((l) => (
                  <label key={l} className="intg-toggle" style={{ fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={pickedLocations.includes(l)}
                      onChange={() => {
                        toggle(pickedLocations, l, setPickedLocations);
                        setPreview(null);
                      }}
                    />
                    {l}
                  </label>
                ))}
              </div>
              <p className="field-hint">None ticked means any location.</p>
            </div>
          )}

          <div className="push-actions">
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={async () => {
                const data = await call<Preview>("preview", "/api/manager/campaigns/preview", "POST", {
                  filters,
                  body,
                });
                if (data) setPreview(data);
              }}
            >
              {busy === "preview" ? "Counting…" : "Count who this reaches"}
            </button>
            {preview && (
              <span className="card-sub" style={{ margin: 0 }}>
                <strong>{preview.recipients.toLocaleString()}</strong> people · about ${cost.toFixed(2)} · roughly{" "}
                {minutes} minute{minutes === 1 ? "" : "s"} to send
                {preview.optedOut > 0 && ` · ${preview.optedOut} opted out and skipped`}
              </span>
            )}
          </div>

          {preview && preview.sample.length > 0 && (
            <p className="field-hint">
              For example: {preview.sample.map((s) => `${s.name ?? "—"} ${s.phone}`).join(", ")}
            </p>
          )}

          <h3 className="intg-subhead">Try it on your own phone first</h3>
          <div className="push-actions">
            <div className="field" style={{ maxWidth: 220 }}>
              <label htmlFor="c-test">Your phone number</label>
              <input
                id="c-test"
                type="tel"
                value={testPhone}
                placeholder="204 555 0134"
                onChange={(e) => setTestPhone(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy !== null || !smsReady}
              onClick={async () => {
                const ok = await call("test", "/api/manager/campaigns/test", "POST", { phone: testPhone, body });
                if (ok) setNotice(`Sent to ${testPhone}. Check it reads the way you want before sending to everyone.`);
              }}
            >
              {busy === "test" ? "Sending…" : "Send me a test"}
            </button>
          </div>

          <div className="form-actions" style={{ justifyContent: "flex-start" }}>
            <button
              type="button"
              className="btn"
              disabled={busy !== null || !preview || !smsReady || preview.recipients === 0}
              onClick={() => setConfirming(true)}
            >
              Create and start sending
            </button>
          </div>
          {!preview && <p className="field-hint">Count who it reaches first.</p>}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Text ${preview?.recipients.toLocaleString() ?? ""} customers?`}
        confirmLabel="Yes, start sending"
        busy={busy !== null}
        onConfirm={async () => {
          const created = await call<{ campaign: { id: string } }>("create", "/api/manager/campaigns", "POST", {
            name,
            body,
            filters,
          });
          if (!created) return;
          const started = await call(
            "start",
            `/api/manager/campaigns/${created.campaign.id}/status`,
            "PATCH",
            { status: "sending" }
          );
          setConfirming(false);
          if (started) router.push(`/manager/marketing/${created.campaign.id}`);
        }}
        onCancel={() => busy === null && setConfirming(false)}
      >
        <p>
          This sends <strong>{preview?.recipients.toLocaleString()}</strong> texts at about{" "}
          <strong>${cost.toFixed(2)}</strong>, over roughly {minutes} minute{minutes === 1 ? "" : "s"}. They read:
        </p>
        <p className="campaign-preview">{shown}</p>
        <p>You can pause it at any point, but texts already sent can&apos;t be taken back.</p>
      </ConfirmDialog>
    </>
  );
}
