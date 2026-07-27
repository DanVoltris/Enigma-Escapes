// Partner API keys (server-only): created in Settings → Developers, required
// by /api/partner/* endpoints. Stored in the settings table under
// "partner_api_keys". The feed exposes availability only — no customer data —
// so a leaked key can read schedules, nothing more, and can be revoked here.
import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { getSetting, saveSetting } from "./settings";

export type ApiKey = {
  id: string;
  label: string; // who it was issued to, e.g. "Morty"
  key: string; // vb_<48 hex chars>
  createdAt: string;
};

const SETTING_KEY = "partner_api_keys";

export async function listApiKeys(): Promise<ApiKey[]> {
  try {
    const { value } = await getSetting<ApiKey[]>(SETTING_KEY);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function createApiKey(label: string): Promise<ApiKey> {
  const keys = await listApiKeys();
  const apiKey: ApiKey = {
    id: randomUUID(),
    label,
    key: `vb_${randomBytes(24).toString("hex")}`,
    createdAt: new Date().toISOString(),
  };
  await saveSetting(SETTING_KEY, [...keys, apiKey]);
  return apiKey;
}

// Revocation is deletion — the key stops working immediately.
export async function revokeApiKey(id: string): Promise<boolean> {
  const keys = await listApiKeys();
  const remaining = keys.filter((k) => k.id !== id);
  if (remaining.length === keys.length) return false;
  await saveSetting(SETTING_KEY, remaining);
  return true;
}

// Accepts the key as "Authorization: Bearer vb_..." or ?key=vb_... (some
// partner tools can't set headers). Constant-time comparison per candidate.
export async function verifyPartnerRequest(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const candidate = bearer || req.nextUrl.searchParams.get("key") || "";
  if (!candidate.startsWith("vb_")) return false;
  const candidateBuf = Buffer.from(candidate);
  const keys = await listApiKeys();
  return keys.some((k) => {
    const buf = Buffer.from(k.key);
    return buf.length === candidateBuf.length && timingSafeEqual(buf, candidateBuf);
  });
}
