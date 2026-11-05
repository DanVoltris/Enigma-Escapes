// Remembering what rarely changes, so a page view doesn't re-read it.
//
// Every page renders per request (the CSP nonce in proxy.ts requires it), and
// every render read the venue's name, locale, look, rooms and opening hours
// from the database again — thousands of times a day for values that change a
// few times a month. Vercel bills the CPU that work burns.
//
// Reads of those tables are cached in Next's data cache, keyed by business and
// tagged by table (or settings key). Any write to one through rest() drops its
// tag at once ({ expire: 0 }), so a change saved in the portal shows on the
// next request, never a stale copy. The TTL is the backstop for changes made
// outside the app (SQL editor, scripts), which don't pass through rest().
//
// Only on a deployment pinned to one business (VENUE_TENANT_ID). The platform
// deployment chooses the business per request from its web address, and the
// cache must never be the thing that decides which business's data a page gets.
import { revalidateTag, unstable_cache } from "next/cache";

export { AVAILABILITY_TAG, readTags, writeTags } from "./db-cache-rules";

const TTL_SECONDS = 300;

const scoped = (tenant: string, tags: string[]) => tags.map((t) => `${tenant}:${t}`);

/** A cached GET through rest(), as a fresh Response each time. */
export async function cachedRead(
  tenant: string,
  path: string,
  tags: string[],
  load: () => Promise<Response>
): Promise<Response> {
  const read = unstable_cache(
    async () => {
      const res = await load();
      const body = await res.text();
      // A database hiccup must not be remembered for five minutes.
      if (res.status >= 500) throw new Error(`database ${res.status}`);
      return { status: res.status, body };
    },
    ["rest", tenant, path],
    { tags: scoped(tenant, tags), revalidate: TTL_SECONDS }
  );
  try {
    const { status, body } = await read();
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  } catch {
    return load();
  }
}

/** Drop the caches a successful write made stale. */
export function invalidate(tenant: string, tags: string[]): void {
  for (const tag of scoped(tenant, tags)) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch (err) {
      // Outside a route handler or server action (a write made while a page
      // renders, or after a response): nothing to invalidate from here, and
      // the TTL bounds how long anything stays stale.
      console.warn(`could not clear cache tag ${tag}:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Cache a whole computation for one business. Pinned deployments only; with
 * no pinned business it simply runs `fn`.
 */
export async function cachedForVenue<T>(
  tenant: string | undefined,
  keyParts: string[],
  tags: string[],
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  if (!tenant) return fn();
  return unstable_cache(fn, ["venue", tenant, ...keyParts], { tags: scoped(tenant, tags), revalidate: ttlSeconds })();
}
