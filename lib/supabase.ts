import { tenantAuthFromEnv, tenantToken, type TenantAuth } from "./tenant-token";

// Server-only Supabase access via the PostgREST API.
//
// Every request carries a short-lived token naming the business
// (lib/tenant-token.ts), runs as the tenant_app role, and row level security
// keeps it to that business's rows (migrations/0004): a query that forgets to
// filter by business gets nothing back instead of everything.
//
// There is no longer a fallback to the service_role key, which skips every
// policy. A venue missing its tenant settings fails here, loudly, rather than
// quietly running unprotected — the whole point of the policies is that no
// request from the app can be outside them. Staging, Time Zone and Enigma were
// switched over on 2026-09-14/15.
//
// Still on the service_role key, each for its own reason: lib/storage.ts (photo
// uploads go to Supabase Storage, which has its own rules, not these policies)
// and the scripts in scripts/ (the migration runner has to change the schema;
// the importers and seed-venue are run by hand against one venue's env file and
// rely on the database filling in the business for new rows).
//
// The key and secret must never reach the browser: they are only ever read
// here, inside server code, from environment variables.
// Supabase's API-keys page shows example URLs that already carry /rest/v1, so
// that is what gets pasted into the variable about half the time. Appending our
// own then asks for /rest/v1/rest/v1/… and PostgREST answers 404 PGRST125,
// "Invalid path specified in request URL" — an error that names neither the
// variable nor the cause. Accept the project root with or without the suffix.
export function normalizeUrl(raw: string | undefined): string | undefined {
  return raw?.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/+$/, "");
}

const SUPABASE_URL = normalizeUrl(process.env.SUPABASE_URL);
// Read once. Throws at the first database call if the venue is half configured —
// loud on purpose, rather than silently using the key that skips every policy.
let tenantAuth: TenantAuth | null | undefined;
function currentTenantAuth(): TenantAuth | null {
  if (tenantAuth === undefined) tenantAuth = tenantAuthFromEnv();
  return tenantAuth;
}

/** Which way this deployment reaches its database. */
export function databaseMode(): "local" | "tenant" {
  if (useLocalData()) return "local";
  currentTenantAuth(); // throws if half configured
  return "tenant";
}

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
  const tenant = currentTenantAuth();
  if (!SUPABASE_URL || !tenant) {
    throw new Error(
      "This venue's database access is not configured. Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, " +
        "SUPABASE_JWT_SECRET and VENUE_TENANT_ID (see CLAUDE.md, \"Isolation between businesses\"), " +
        "or set USE_LOCAL_DATA=true to run on local mock data."
    );
  }
  const auth = { apikey: tenant.apikey, Authorization: `Bearer ${tenantToken(tenant)}` };
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...auth,
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
