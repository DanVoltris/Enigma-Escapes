import { randomUUID } from "crypto";
import { useLocalData } from "./supabase";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "experience-images";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

// The public base URL for objects in the experience-images bucket. Stored
// image_url values must start with this, which guards against arbitrary URLs.
// In local mode there is no bucket — images are inlined as data: URLs, so the
// accepted prefix is "data:".
export function publicImageBase(): string {
  if (useLocalData()) return "data:";
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
}

// Uploads image bytes to Supabase Storage and returns the public URL. In local
// mode, there's no cloud storage, so the image is returned inline as a data URL.
export async function uploadExperienceImage(bytes: ArrayBuffer, contentType: string): Promise<string> {
  if (useLocalData()) {
    const ext = EXT[contentType];
    if (!ext) throw new Error("Unsupported image type.");
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  }
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Supabase storage is not configured.");
  const ext = EXT[contentType];
  if (!ext) throw new Error("Unsupported image type.");
  const path = `${randomUUID()}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": contentType,
      "cache-control": "3600",
    },
    body: bytes,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Image upload failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return `${publicImageBase()}${path}`;
}
