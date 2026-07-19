"use client";

import { useEffect, useRef, useState } from "react";

// Shared behaviour for custom dropdowns: track open state, and close when the
// user clicks outside the element or presses Escape. Returns a ref to attach to
// the popover's outer container.
export function usePopover<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return { ref, open, setOpen };
}
