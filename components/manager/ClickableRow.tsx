"use client";

import { useRouter } from "next/navigation";

// Makes a whole table row open something, while leaving the row's own links and
// buttons to do their own job. A thin wrapper rather than a client version of
// the row itself: the rows it wraps are built on the server and stay there.
//
// Three things it deliberately does NOT treat as "open this row":
//
//   - a click that landed on a link or a button, which already knows where it
//     goes (and which a modifier-click should open in a tab, not here);
//   - a click that ends a text selection, because staff copy email addresses
//     out of these rows and navigating away mid-drag is maddening;
//   - a modifier or middle click, which opens a new tab instead — the same
//     thing the reference link has always done.
export default function ClickableRow({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  function isInteractive(target: EventTarget | null): boolean {
    return Boolean(
      target instanceof Element && target.closest("a, button, input, select, textarea, label")
    );
  }

  function hasSelection(): boolean {
    const s = typeof window !== "undefined" ? window.getSelection() : null;
    return Boolean(s && !s.isCollapsed && s.toString().trim().length > 0);
  }

  return (
    <tr
      className="row-link"
      onClick={(e) => {
        if (isInteractive(e.target) || hasSelection()) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          window.open(href, "_blank", "noopener");
          return;
        }
        router.push(href);
      }}
      onAuxClick={(e) => {
        // Middle click, the other way people open things in a new tab.
        if (e.button !== 1 || isInteractive(e.target)) return;
        e.preventDefault();
        window.open(href, "_blank", "noopener");
      }}
    >
      {children}
    </tr>
  );
}
