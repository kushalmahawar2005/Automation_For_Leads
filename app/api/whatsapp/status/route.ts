import { NextResponse } from "next/server";
import { getWhatsAppStatus, connectWhatsApp, logoutWhatsApp } from "@/lib/whatsapp";
import { stopCampaign } from "@/lib/sender";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(getWhatsAppStatus(user.id));
}

export async function PUT() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  connectWhatsApp(user.id);
  return NextResponse.json(getWhatsAppStatus(user.id));
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    stopCampaign(user.id);
    await logoutWhatsApp(user.id);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Logout failed" }, { status: 500 });
  }
}
