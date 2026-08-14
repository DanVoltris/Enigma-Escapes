// Server-only Supabase access via the PostgREST API. Uses the service_role key,
// which bypasses row level security — it must never be exposed to the browser
// (only ever read here, inside server code, from environment variables).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// When true, all data access is served by a local file-backed store instead of
// Supabase (see lib/local-db.ts) — for development with no database. Set
// USE_LOCAL_DATA=true in .env.local. Read at call time so it's always current.
export function useLocalData(): boolean {
  return process.env.USE_LOCAL_DATA === "true" || process.env.USE_LOCAL_DATA === "1";
}

export async function rest(path: string, init?: RequestInit): Promise<Response> {
  if (useLocalData()) {
    const { localRest } = await import("./local-db");
    return localRest(path, init);
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (see CLAUDE.md), " +
        "or set USE_LOCAL_DATA=true to run on local mock data."
    );
  }
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
}

export async function restError(res: Response, doing: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  return new Error(`${doing} failed (Supabase ${res.status}): ${body.slice(0, 300)}`);
}

// PostgREST caps a plain select at 1000 rows, so any table that can outgrow
// that has to be paged. Pages go out in parallel batches: each one costs about
// a fifth of a second at the database, but the customer roster is 45 of them
// and waiting on each in turn added up to the 21 seconds that stopped the
// Customers tab loading at all.
//
// (Measured from a server next to the database. Timed over a home connection
// the same change looks like a slowdown, because there the bottleneck is
// bandwidth rather than the number of round trips — don't re-measure it from a
// laptop and conclude the loop should go back to being sequential.)
//
// `path` must carry its own select and order and no limit/offset. The order
// must be unique (see listBookings / listManualCustomers) or rows shift between
// pages. Returns null if the table doesn't exist yet.
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;
const BATCH = 8;

export async function restAllPages<T>(path: string, doing: string): Promise<T[] | null> {
  const rows: T[] = [];
  for (let first = 0; first < MAX_PAGES; first += BATCH) {
    const pages = await Promise.all(
      Array.from({ length: BATCH }, (_, i) => first + i).map(async (page) => {
        const res = await rest(`${path}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
        if (res.status === 404) return null; // table not created yet
        if (!res.ok) throw await restError(res, doing);
        return (await res.json()) as T[];
      })
    );
    if (pages[0] === null) return first === 0 ? null : rows;
    for (const page of pages) {
      if (page === null) return rows;
      rows.push(...page);
      // A short page is the end of the table — anything after it in this batch
      // was requested speculatively and came back empty.
      if (page.length < PAGE_SIZE) return rows;
    }
  }
  return rows;
}
