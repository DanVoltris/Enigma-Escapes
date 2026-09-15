import NotificationSettings from "@/components/manager/NotificationSettings";
import { requireStaff } from "@/lib/auth";
import { getPrefs, listDevices, pushPublicKey, summarize } from "@/lib/push";
import { eventsFor } from "@/lib/push-events";

export const dynamic = "force-dynamic";

// Everyone's own page, whatever their permissions: turning notifications on for
// a phone, choosing which alerts, and seeing which of their phones get them.
export default async function NotificationsPage() {
  const staff = await requireStaff("/manager/notifications");
  const [prefs, devices] = await Promise.all([
    getPrefs(staff.id),
    listDevices(`&staff_id=eq.${encodeURIComponent(staff.id)}`).catch(() => []),
  ]);
  return (
    <NotificationSettings
      publicKey={pushPublicKey()}
      events={eventsFor(staff)}
      initialPrefs={prefs}
      devices={devices.map(summarize)}
    />
  );
}
