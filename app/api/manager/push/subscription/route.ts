import { NextRequest, NextResponse } from "next/server";
import { apiGuard, currentStaff } from "@/lib/auth";
import { deleteDevice, listDevices, pushConfigured, saveDevice } from "@/lib/push";
import { deviceLabel, pushEndpointProblem } from "@/lib/push-events";

export const dynamic = "force-dynamic";

// The two keys a browser hands back are base64url; anything else isn't one.
const KEY_RE = /^[A-Za-z0-9_-]{16,200}={0,2}$/;

function readSubscription(o: Record<string, unknown>) {
  const sub = (o.subscription ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const problem = pushEndpointProblem(sub.endpoint);
  if (problem) return { error: problem };
  const p256dh = sub.keys?.p256dh;
  const auth = sub.keys?.auth;
  if (typeof p256dh !== "string" || !KEY_RE.test(p256dh) || typeof auth !== "string" || !KEY_RE.test(auth)) {
    return { error: "The phone sent incomplete notification details. Try turning notifications on again." };
  }
  return { endpoint: sub.endpoint as string, p256dh, auth };
}

// Turn notifications on for this phone, for whoever is signed in.
//
// Also where the service worker reports a phone whose address was renewed
// (pushsubscriptionchange). That can happen long after the session cookie has
// expired, so it is accepted without a session when it names an address we
// already hold — the old address is itself the secret, and the new one only
// ever replaces it for the same person.
export async function POST(req: NextRequest) {
  if (!pushConfigured()) {
    return NextResponse.json({ error: "Phone notifications aren't set up for this venue yet." }, { status: 503 });
  }
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const sub = readSubscription(o);
  if ("error" in sub) return NextResponse.json({ error: sub.error }, { status: 400 });
  const replaces = typeof o.replaces === "string" && o.replaces.length <= 1000 ? o.replaces : null;

  const staff = await currentStaff();
  let staffId = staff?.id ?? null;
  if (!staffId && replaces) {
    const old = (await listDevices(`&endpoint=eq.${encodeURIComponent(replaces)}&limit=1`))[0];
    staffId = old?.staff_id ?? null;
  }
  if (!staffId) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  try {
    const device = await saveDevice({
      staffId,
      ...sub,
      device: deviceLabel(req.headers.get("user-agent")),
      replaces,
    });
    return NextResponse.json({ ok: true, id: device.id });
  } catch (err) {
    console.error("saving push subscription failed:", err);
    return NextResponse.json(
      { error: err instanceof Error && err.message.includes("0005") ? err.message : "Could not turn notifications on. Please try again." },
      { status: 500 }
    );
  }
}

// Turn notifications off for this phone. Only the signed-in person's own phone.
export async function DELETE(req: NextRequest) {
  const guard = await apiGuard();
  if (guard.response) return guard.response;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof o.endpoint !== "string" || o.endpoint.length > 1000) {
    return NextResponse.json({ error: "Say which phone to turn off." }, { status: 400 });
  }
  const device = (await listDevices(`&endpoint=eq.${encodeURIComponent(o.endpoint)}&limit=1`))[0];
  if (device && device.staff_id === guard.staff.id) await deleteDevice(device.id);
  return NextResponse.json({ ok: true });
}
