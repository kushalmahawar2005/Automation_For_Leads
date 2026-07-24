import { NextResponse } from "next/server";
import path from "path";
import { getSessionUser } from "@/lib/auth";
import { startCampaign, getCampaign, stopCampaign } from "@/lib/sender";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MEDIA_ROOT = process.env.MEDIA_PATH || path.join(process.cwd(), ".media");

// Start a bulk campaign.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { leadIds, templateBody, fallbackLocation, mediaToken } = body as {
    leadIds?: string[];
    templateBody?: string;
    fallbackLocation?: string;
    mediaToken?: string;
  };

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return NextResponse.json({ error: "Select at least one lead." }, { status: 400 });
  }
  if (!templateBody || !templateBody.trim()) {
    return NextResponse.json({ error: "Message template is empty." }, { status: 400 });
  }

  // A media token is scoped to the user's folder; reject path traversal.
  let mediaPath: string | null = null;
  if (mediaToken) {
    const safe = path.basename(mediaToken);
    mediaPath = path.join(MEDIA_ROOT, user.id, safe);
  }

  const result = await startCampaign(user.id, {
    leadIds: leadIds.slice(0, 500),
    templateBody,
    fallbackLocation,
    mediaPath,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ started: true, ...serialize(getCampaign(user.id)) });
}

// Poll campaign progress.
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const c = getCampaign(user.id);
  return NextResponse.json(serialize(c));
}

// Stop a running campaign.
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const stopped = stopCampaign(user.id);
  return NextResponse.json({ stopped });
}

function serialize(c: ReturnType<typeof getCampaign>) {
  if (!c) return { campaign: null };
  return {
    campaign: {
      running: c.running,
      total: c.total,
      sent: c.sent,
      failed: c.failed,
      invalid: c.invalid,
      skipped: c.skipped,
      processed: c.processed,
      currentName: c.currentName,
      startedAt: c.startedAt,
      finishedAt: c.finishedAt,
      nextSendAt: c.nextSendAt,
      stopReason: c.stopReason,
      dailyCap: c.dailyCap,
      dailySentToday: c.dailySentToday,
    },
  };
}
