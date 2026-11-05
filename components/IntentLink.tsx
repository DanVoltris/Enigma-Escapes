"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

// A link that loads its page in the background only once someone shows they're
// about to use it — pointing at it, touching it, or tabbing to it — instead of
// as soon as it appears on screen.
//
// Every page here renders per request (the CSP nonce in proxy.ts), and Vercel
// bills each render. Plain <Link> prefetched every link in view: each portal
// page view rendered all sixteen tabs, each customer page the portal and the
// privacy page. Switching prefetching off saved that, but a click then had
// nothing ready and the page sat still until the server answered.
//
// This loads the one page someone is heading for, a few hundred milliseconds
// early. It loads the whole page (prefetch true): "auto" on a per-request page
// only fetches the frame down to a loading boundary, which here is nothing.
// Edits stay correct: saving calls router.refresh(), which discards anything
// loaded in the background before it.
export default function IntentLink(props: ComponentProps<typeof Link>) {
  const [wanted, setWanted] = useState(false);
  const want = () => setWanted(true);
  return (
    <Link
      {...props}
      prefetch={wanted}
      onMouseEnter={(e) => {
        want();
        props.onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        want();
        props.onTouchStart?.(e);
      }}
      onFocus={(e) => {
        want();
        props.onFocus?.(e);
      }}
    />
  );
}
