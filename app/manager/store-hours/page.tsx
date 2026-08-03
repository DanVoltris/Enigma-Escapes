import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";

// Store hours moved under Settings; keep the old URL working.
export default async function StoreHoursRedirect() {
  await requirePermission("settings", "/manager/store-hours");
  redirect("/manager/settings/store-hours");
}
