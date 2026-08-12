// Seeds the staff roster and their room training. Idempotent: skips anyone
// already on the list by name, so it can be re-run safely.
const BASE = process.env.SEED_BASE; // PostgREST base, e.g. http://localhost:3011 (local) or Supabase
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const LOCAL = process.env.SEED_LOCAL === "true";

const GP = { SG: "shady-grove", SOS: "school-of-sorcery", BOC: "butcher-catacombs", RW: "raven-woods", DH: "dark-hedges" };
const ML = { BB: "blackbeards-brig", PP: "poseidons-promise", PG: "pele-goddess", SE: "lucky-duck" };
const ALL_ML = Object.values(ML);
const ALL_GP = Object.values(GP);
const r = (...keys) => keys.map((k) => GP[k] ?? ML[k]);

const ROSTER = [
  // Lorimer
  ["Paige Friesen", "Lorimer", ALL_ML],
  ["Jonah Polet", "Lorimer", ALL_ML],
  ["Sebastien Pichon", "Lorimer", ALL_ML],
  ["Katelyn Kochan", "Lorimer", ALL_ML],
  ["Adam Khalimov", "Lorimer", ALL_ML],
  ["Matthew Buchwald", "Lorimer", ALL_ML],
  // Grant Park
  ["Mark Sterner", "Grant Park", ALL_GP],
  ["Ian Steinberg", "Grant Park", ALL_GP],
  ["Sutton Rubenstein", "Grant Park", r("BOC", "RW")],
  ["Josephine St. Hilaire", "Grant Park", ALL_GP],
  ["Deb Stanley", "Grant Park", ALL_GP],
  ["Allison Buhay", "Grant Park", ALL_GP],
  ["Hammy Karimi-Mohamed", "Grant Park", ALL_GP],
  ["Josh Smith", "Grant Park", r("SG", "SOS", "BOC", "DH")],
  ["Liron Samphir", "Grant Park", r("DH", "BOC")],
  ["Evan Windle", "Grant Park", ALL_GP],
  // Both sites
  ["Tali Nudler", null, [...ALL_ML, ...ALL_GP]],
  ["Abby MacArthur", null, [...ALL_ML, ...ALL_GP]],
  ["Liam Drummond", null, [...ALL_ML, ...ALL_GP]],
  ["Mark Bubis", null, [...ALL_ML, ...r("SG", "DH", "BOC")]],
  ["Scott Kosokowsky", null, [...ALL_ML, ...ALL_GP.filter((x) => x !== GP.RW)]],
];

const url = (p) => (LOCAL ? `${BASE}/api/__seed/${p}` : `${BASE}/rest/v1/${p}`);
const headers = LOCAL ? { "Content-Type": "application/json" } : { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const existing = await (await fetch(url("staff_members?select=name"), { headers })).json();
const have = new Set(existing.map((m) => m.name));

let added = 0;
for (const [name, home, rooms] of ROSTER) {
  if (have.has(name)) continue;
  const res = await fetch(url("staff_members"), {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      name,
      home_location: home,
      trained_rooms: rooms,
      active: true,
      created_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) { console.error("failed:", name, res.status, (await res.text()).slice(0, 120)); continue; }
  added++;
}
console.log(`seeded ${added} staff (${have.size} already present, ${ROSTER.length} in roster)`);
