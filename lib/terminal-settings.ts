// Which Stripe reader sits at which venue. Staff at Grant Park press "Send to
// terminal" and it must wake the Grant Park reader, not Lorimer's.
// Stored in the settings table under "terminal_readers" as { venue: readerId }.
import { getSetting, saveSetting } from "./settings";

const KEY = "terminal_readers";

export async function getReaderMap(): Promise<Record<string, string>> {
  try {
    const { value } = await getSetting<Record<string, string>>(KEY);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export async function saveReaderMap(map: Record<string, string>): Promise<void> {
  await saveSetting(KEY, map);
}

export async function readerForLocation(location: string): Promise<string | null> {
  const map = await getReaderMap();
  return map[location] ?? null;
}
