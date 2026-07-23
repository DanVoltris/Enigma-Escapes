import LocaleForm from "@/components/manager/LocaleForm";
import { getLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function LocalePage() {
  const locale = await getLocale();
  return <LocaleForm initial={locale} />;
}
