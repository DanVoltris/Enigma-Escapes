// Marketing texts to customers: who gets one, what it says, and sending it
// without texting anybody twice.
//
// A campaign is a message plus the list of numbers it goes to. The list is
// written down when the campaign is created rather than worked out as it sends:
// a send takes hours (a plain phone number manages about one text a second), so
// a list computed on the fly would shift underneath it as people book, and a
// pause would be impossible to resume honestly. Written down, the campaign can
// stop and start, and afterwards there is a record of exactly who was texted.
//
// Consent is not a flag this file sets. Canada's anti-spam law gives implied
// consent for two years after someone buys from you, so the audience is built
// from bookings and from the people who ticked the subscribe box — and anyone
// on the opt-out list is removed, whatever the filters say.
import { randomUUID } from "node:crypto";
import { getCompanyName } from "./settings";
import { campaignText, segmentsFor } from "./campaign-text";
import { normalizeFilters, type CampaignFilters } from "./campaign-filters";
export { normalizeFilters, CONSENT_MONTHS, DEFAULT_FILTERS, type CampaignFilters } from "./campaign-filters";
export { campaignText, segmentsFor };
import { sendCampaignText } from "./sms";
import { rest, restError } from "./supabase";

export type Campaign = {
  id: string;
  name: string;
  body: string;
  audience: CampaignFilters;
  status: "draft" | "sending" | "paused" | "done";
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type CampaignProgress = { total: number; sent: number; failed: number; pending: number };

export type AudienceMember = { phone: string; name: string | null; last_booked: string | null };

// ---------- the opt-out list ----------

// Stored under the last ten digits, like everything else that matches a person
// to a phone number.
export const phoneKey = (phone: string): string => phone.replace(/\D/g, "").slice(-10);

export async function addOptOut(phone: string, source: "reply" | "staff"): Promise<void> {
  const key = phoneKey(phone);
  if (key.length !== 10) return;
  const res = await rest("sms_optouts?on_conflict=tenant_id,phone", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify([{ phone: key, source }]),
  });
  if (!res.ok && res.status !== 404) throw await restError(res, "Recording the opt-out");
}

export async function removeOptOut(phone: string): Promise<void> {
  const key = phoneKey(phone);
  if (key.length !== 10) return;
  const res = await rest(`sms_optouts?phone=eq.${key}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok && res.status !== 404) throw await restError(res, "Undoing the opt-out");
}

export async function isOptedOut(phone: string): Promise<boolean> {
  const key = phoneKey(phone);
  if (key.length !== 10) return false;
  const res = await rest(`sms_optouts?phone=eq.${key}&select=phone&limit=1`);
  if (!res.ok) return false; // never let a lookup failure block a service text
  return ((await res.json()) as unknown[]).length > 0;
}

// Which of these numbers have opted out — one query for a whole screenful.
// Staff need this on the Requests board: a number that replied STOP cannot be
// reached by ANY text from our number, booking confirmations included, so the
// only way to answer that customer is to ring them.
export async function optedOutAmong(phones: string[]): Promise<Set<string>> {
  const keys = [...new Set(phones.map(phoneKey).filter((k) => k.length === 10))];
  if (keys.length === 0) return new Set();
  const res = await rest(`sms_optouts?phone=in.(${keys.join(",")})&select=phone`);
  if (!res.ok) return new Set(); // a lookup failure must never hide a request
  const rows = (await res.json()) as { phone: string }[];
  return new Set(rows.map((r) => r.phone));
}

export async function countOptOuts(): Promise<number> {
  const res = await rest("sms_optouts?select=phone", { headers: { Prefer: "count=exact" } });
  if (!res.ok) return 0;
  const range = res.headers.get("content-range");
  return range ? Number(range.split("/")[1]) || 0 : ((await res.json()) as unknown[]).length;
}

// ---------- who it goes to ----------

// PostgREST answers with at most a thousand rows, so this reads pages until a
// short one comes back. Without that a campaign to eight thousand customers
// would quietly be a campaign to one thousand, and the count on screen would
// have agreed with it.
const PAGE = 1000;
const MAX_AUDIENCE = 100_000;

// Just the number of people, for the composer's count. The whole list is only
// read when a campaign is actually created.
export async function audienceCount(filters: CampaignFilters): Promise<number> {
  const res = await rest("rpc/campaign_audience_count", {
    method: "POST",
    body: JSON.stringify({
      months: filters.months,
      include_subscribers: filters.includeSubscribers,
      area_codes: filters.areaCodes.length ? filters.areaCodes : null,
      locations: filters.locations.length ? filters.locations : null,
    }),
  });
  if (!res.ok) throw await restError(res, "Counting who this would reach");
  const value = await res.json();
  return typeof value === "number" ? value : Number(value?.[0]?.campaign_audience_count ?? 0);
}

// A handful of names, to show the filters picked who the manager expected.
export async function audienceSample(filters: CampaignFilters, limit = 5): Promise<AudienceMember[]> {
  const res = await rest(`rpc/campaign_audience?limit=${limit}&order=phone.asc`, {
    method: "POST",
    body: JSON.stringify({
      months: filters.months,
      include_subscribers: filters.includeSubscribers,
      area_codes: filters.areaCodes.length ? filters.areaCodes : null,
      locations: filters.locations.length ? filters.locations : null,
    }),
  });
  if (!res.ok) return [];
  return (await res.json()) as AudienceMember[];
}

export async function audienceFor(filters: CampaignFilters): Promise<AudienceMember[]> {
  const body = JSON.stringify({
    months: filters.months,
    include_subscribers: filters.includeSubscribers,
    area_codes: filters.areaCodes.length ? filters.areaCodes : null,
    locations: filters.locations.length ? filters.locations : null,
  });
  const out: AudienceMember[] = [];
  for (let offset = 0; offset < MAX_AUDIENCE; offset += PAGE) {
    const res = await rest(`rpc/campaign_audience?limit=${PAGE}&offset=${offset}&order=phone.asc`, {
      method: "POST",
      body,
    });
    if (!res.ok) throw await restError(res, "Working out who this would reach");
    const page = (await res.json()) as AudienceMember[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

// ---------- campaigns ----------

type Row = {
  id: string;
  name: string;
  body: string;
  audience: unknown;
  status: string;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const toCampaign = (r: Row): Campaign => ({
  id: r.id,
  name: r.name,
  body: r.body,
  audience: normalizeFilters(r.audience),
  status: r.status === "sending" || r.status === "paused" || r.status === "done" ? r.status : "draft",
  createdBy: r.created_by,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export async function listCampaigns(): Promise<Campaign[]> {
  const res = await rest("campaigns?select=*&order=created_at.desc&limit=50");
  if (res.status === 404) return [];
  if (!res.ok) throw await restError(res, "Loading campaigns");
  return ((await res.json()) as Row[]).map(toCampaign);
}

export async function getCampaign(id: string): Promise<Campaign | undefined> {
  const res = await rest(`campaigns?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  if (!res.ok) return undefined;
  const rows = (await res.json()) as Row[];
  return rows[0] ? toCampaign(rows[0]) : undefined;
}

// One query, not three: this is asked for after every batch while a campaign
// sends, so it sits in the middle of the send loop.
export async function progressFor(id: string): Promise<CampaignProgress> {
  const res = await rest("rpc/campaign_progress", {
    method: "POST",
    body: JSON.stringify({ p_campaign_id: id }),
  });
  if (!res.ok) return { pending: 0, sent: 0, failed: 0, total: 0 };
  const [row] = (await res.json()) as { sent: number; failed: number; pending: number }[];
  const sent = Number(row?.sent ?? 0);
  const failed = Number(row?.failed ?? 0);
  const pending = Number(row?.pending ?? 0);
  return { sent, failed, pending, total: sent + failed + pending };
}

// Every campaign's progress in one go, for the list.
export async function progressForAll(): Promise<Map<string, CampaignProgress>> {
  const res = await rest("rpc/campaign_progress_all", { method: "POST", body: "{}" });
  if (!res.ok) return new Map();
  const rows = (await res.json()) as { campaign_id: string; sent: number; failed: number; pending: number }[];
  return new Map(
    rows.map((r) => {
      const sent = Number(r.sent ?? 0);
      const failed = Number(r.failed ?? 0);
      const pending = Number(r.pending ?? 0);
      return [r.campaign_id, { sent, failed, pending, total: sent + failed + pending }];
    })
  );
}

// Writes the campaign and the list of numbers it will go to. Returns the
// campaign and how many people are on it.
export async function createCampaign(input: {
  name: string;
  body: string;
  filters: CampaignFilters;
  createdBy: string;
}): Promise<{ campaign: Campaign; recipients: number }> {
  const audience = await audienceFor(input.filters);
  const id = randomUUID();
  const row = {
    id,
    name: input.name.trim().slice(0, 120),
    body: input.body.trim().slice(0, 1200),
    audience: input.filters,
    status: "draft",
    created_by: input.createdBy,
    created_at: new Date().toISOString(),
  };
  const created = await rest("campaigns", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!created.ok) throw await restError(created, "Creating the campaign");

  // In chunks: one insert of several thousand rows is a request big enough to
  // be refused, and a half-written list is worse than a slow one.
  for (let i = 0; i < audience.length; i += 500) {
    const chunk = audience.slice(i, i + 500).map((m) => ({
      campaign_id: id,
      phone: m.phone,
      name: m.name,
      status: "pending",
    }));
    const res = await rest("campaign_recipients?on_conflict=tenant_id,campaign_id,phone", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw await restError(res, "Saving who the campaign goes to");
  }
  return { campaign: toCampaign(row as unknown as Row), recipients: audience.length };
}

export async function setCampaignStatus(id: string, status: Campaign["status"]): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === "sending") patch.started_at = new Date().toISOString();
  if (status === "done") patch.finished_at = new Date().toISOString();
  const res = await rest(`campaigns?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await restError(res, "Updating the campaign");
}

// Sends the next few. Called over and over by the page watching the send, so
// each call is short enough to finish inside a request: a plain phone number
// sends about one text a second, and the hosting cuts a request off at a minute.
export async function sendNextBatch(
  id: string,
  limit = 25
): Promise<{ sent: number; failed: number; remaining: number; done: boolean }> {
  const campaign = await getCampaign(id);
  if (!campaign) throw new Error("That campaign no longer exists.");
  if (campaign.status !== "sending") return { sent: 0, failed: 0, remaining: 0, done: campaign.status === "done" };

  const res = await rest(
    `campaign_recipients?campaign_id=eq.${encodeURIComponent(id)}&status=eq.pending&select=id,phone,name&order=id.asc&limit=${limit}`
  );
  if (!res.ok) throw await restError(res, "Reading who is left to text");
  const batch = (await res.json()) as { id: string; phone: string; name: string | null }[];
  if (batch.length === 0) {
    await setCampaignStatus(id, "done");
    return { sent: 0, failed: 0, remaining: 0, done: true };
  }

  const text = campaignText(await getCompanyName(), campaign.body);
  let sent = 0;
  let failed = 0;
  for (const person of batch) {
    // A row with no id would turn the update below into "every row like this".
    // It can't happen against the database, which fills the id in; it did
    // happen in local mode, and the cost of checking is nothing.
    if (!person.id) continue;
    const result = await sendCampaignText(person.phone, text);
    const patch: Record<string, unknown> = result.ok
      ? { status: "sent", sent_at: new Date().toISOString(), error: null }
      : { status: "failed", error: result.error.slice(0, 300) };
    if (result.ok) sent++;
    else failed++;
    // Twilio knows this number has opted out of this sender; remember it so no
    // later campaign tries again.
    if (!result.ok && result.optedOut) {
      try {
        await addOptOut(person.phone, "reply");
      } catch {
        // The send result still gets recorded below.
      }
    }
    await rest(`campaign_recipients?id=eq.${person.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    }).catch(() => null);
  }

  const after = await progressFor(id);
  if (after.pending === 0) await setCampaignStatus(id, "done");
  return { sent, failed, remaining: after.pending, done: after.pending === 0 };
}
