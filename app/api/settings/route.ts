import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    let settings = await prisma.settings.findUnique({ where: { userId: user.id } });
    if (!settings) {
      settings = await prisma.settings.create({
        data: { userId: user.id, userProfession: "Web Developer" },
      });
    }
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const data = await req.json();

    // Whitelist writable fields; coerce + clamp anti-ban controls so a bad
    // value can't turn the throttling off.
    const safe: Record<string, unknown> = {};
    if (typeof data.userName === "string") safe.userName = data.userName;
    if (typeof data.userBusiness === "string") safe.userBusiness = data.userBusiness;
    if (typeof data.userProfession === "string") safe.userProfession = data.userProfession;
    if (typeof data.serpApiKey === "string") safe.serpApiKey = data.serpApiKey;

    if (data.dailyCap !== undefined) safe.dailyCap = clampInt(data.dailyCap, 1, 200, 40);
    if (data.minDelaySec !== undefined) safe.minDelaySec = clampInt(data.minDelaySec, 3, 600, 8);
    if (data.maxDelaySec !== undefined) safe.maxDelaySec = clampInt(data.maxDelaySec, 3, 900, 30);
    if (data.batchSize !== undefined) safe.batchSize = clampInt(data.batchSize, 1, 100, 10);
    if (data.batchPauseSec !== undefined) safe.batchPauseSec = clampInt(data.batchPauseSec, 0, 3600, 90);
    if (data.warmup !== undefined) safe.warmup = Boolean(data.warmup);
    if (data.validateNumbers !== undefined) safe.validateNumbers = Boolean(data.validateNumbers);

    // Keep max >= min so delays never invert.
    if (
      safe.minDelaySec !== undefined &&
      safe.maxDelaySec !== undefined &&
      (safe.maxDelaySec as number) < (safe.minDelaySec as number)
    ) {
      safe.maxDelaySec = safe.minDelaySec;
    }

    const settings = await prisma.settings.upsert({
      where: { userId: user.id },
      update: safe,
      create: { userId: user.id, ...safe },
    });
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}

// Clamp a number into a safe range, falling back to a default.
function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
