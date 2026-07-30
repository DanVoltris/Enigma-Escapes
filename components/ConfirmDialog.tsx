"use client";

import { useEffect, useRef } from "react";

// In-app replacement for window.confirm — styled like the rest of the app
// instead of the browser's native dialog. Escape or clicking the backdrop
// cancels; the confirm button takes focus so Enter confirms.
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <div className="confirm-body">{children}</div>
        <div className="confirm-actions">
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" ref={confirmRef} className="btn" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
