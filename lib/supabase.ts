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
// that has to be paged. Kept sequential deliberately: fetching the pages
// concurrently was measured against the live database and came out slower
// (28-31s at 4 and 8 at a time, against 26s one after another) — the cost is
// shifting the rows, not waiting on round trips, so concurrency only adds
// contention.
//
// `path` must carry its own select and order and no limit/offset. The order
// must be unique (see listBookings / listManualCustomers) or rows shift between
// pages. Returns null if the table doesn't exist yet.
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;

export async function restAllPages<T>(path: string, doing: string): Promise<T[] | null> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await rest(`${path}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
    if (res.status === 404) return page === 0 ? null : rows; // table not created yet
    if (!res.ok) throw await restError(res, doing);
    const batch = (await res.json()) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}
