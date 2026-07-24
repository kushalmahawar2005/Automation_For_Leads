import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

const MEDIA_ROOT = process.env.MEDIA_PATH || path.join(process.cwd(), ".media");
const MAX_BYTES = 16 * 1024 * 1024; // WhatsApp media limit ~16MB
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

// Accepts an image or PDF (portfolio / brochure) and returns a token the bulk
// sender can attach to every message.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  const ext = ALLOWED[file.type];
  if (!ext) {
    return NextResponse.json({ error: "Only images and PDF are allowed." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 16MB)." }, { status: 400 });
  }

  const dir = path.join(MEDIA_ROOT, user.id);
  await fs.mkdir(dir, { recursive: true });
  const token = `${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(dir, token), buffer);

  return NextResponse.json({ token, name: file.name, size: file.size, type: file.type });
}
