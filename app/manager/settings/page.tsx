import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";

export default async function SettingsIndex() {
  await requirePermission("settings", "/manager/settings");
  redirect("/manager/settings/business");
}
