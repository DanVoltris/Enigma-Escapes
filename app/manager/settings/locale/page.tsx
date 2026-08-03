import LocaleForm from "@/components/manager/LocaleForm";
import { requirePermission } from "@/lib/auth";
import { getLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function LocalePage() {
  await requirePermission("settings", "/manager/settings/locale");
  const locale = await getLocale();
  return <LocaleForm initial={locale} />;
}
