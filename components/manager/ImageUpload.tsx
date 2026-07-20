"use client";

import { useState } from "react";

// Uploads a poster image through the manager upload endpoint and hands back the
// stored public URL. Shows a preview of the current image.
export default function ImageUpload({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/manager/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not upload the image.");
      onChange(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the image.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      {value && (
        <div className="mgr-image-preview">
          <img src={value} alt="Experience poster preview" />
        </div>
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label className="btn btn-outline" style={{ cursor: "pointer" }}>
          {uploading ? "Uploading…" : value ? "Replace image" : "Choose image"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFile}
            disabled={uploading}
            style={{ display: "none" }}
          />
        </label>
        {value && (
          <button type="button" className="link-button danger" onClick={() => onChange(null)}>
            Remove image
          </button>
        )}
      </div>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 8 }}>
        JPG, PNG or WebP, up to 5 MB. Shown as the poster on the booking site.
      </p>
      {error && <p className="field-error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
