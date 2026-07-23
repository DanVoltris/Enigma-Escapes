import { redirect } from "next/navigation";

export default function SettingsIndex() {
  redirect("/manager/settings/business");
}
