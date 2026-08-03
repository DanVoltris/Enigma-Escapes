"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="link-button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/staff/logout", { method: "POST" }).catch(() => {});
        router.replace("/login");
        router.refresh();
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
