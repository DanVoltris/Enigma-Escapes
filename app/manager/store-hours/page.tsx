import { redirect } from "next/navigation";

// Store hours moved under Settings; keep the old URL working.
export default function StoreHoursRedirect() {
  redirect("/manager/settings/store-hours");
}
