import { NextRequest, NextResponse } from "next/server";
import { MAX_IMAGE_BYTES, uploadExperienceImage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image was provided." }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Use a JPG, PNG or WebP image." }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image is too large — keep it under 5 MB." }, { status: 400 });
  }

  try {
    const url = await uploadExperienceImage(await file.arrayBuffer(), file.type);
    return NextResponse.json({ url }, { status: 201 });
  } catch (err) {
    console.error("image upload failed:", err);
    return NextResponse.json({ error: "Could not upload the image right now. Please try again." }, { status: 500 });
  }
}
