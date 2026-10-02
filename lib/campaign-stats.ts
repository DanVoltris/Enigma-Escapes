// The area codes in the customer list, with how many people each covers, so the
// composer can offer them as filters instead of asking the manager to guess.
import { audienceFor } from "./campaigns";

export async function areaCodeCounts(): Promise<{ code: string; people: number }[]> {
  const rows = await audienceFor({ months: null, includeSubscribers: true, areaCodes: [], locations: [] }).catch(
    () => [] as { phone: string }[]
  );
  const counts = new Map<string, number>();
  for (const r of rows) {
    const code = r.phone.slice(0, 3);
    if (code.length === 3) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, people]) => ({ code, people }))
    .sort((a, b) => b.people - a.people)
    .slice(0, 12);
}
