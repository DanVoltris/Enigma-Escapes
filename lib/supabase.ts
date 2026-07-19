// Server-only Supabase access via the PostgREST API. Uses the service_role key,
// which bypasses row level security — it must never be exposed to the browser
// (only ever read here, inside server code, from environment variables).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function rest(path: string, init?: RequestInit): Promise<Response> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (see CLAUDE.md)."
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
