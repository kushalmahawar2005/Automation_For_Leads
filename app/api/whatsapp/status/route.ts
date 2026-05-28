import { NextResponse } from "next/server";
import { getWhatsAppStatus, initWhatsApp, logoutWhatsApp } from "@/lib/whatsapp";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = getWhatsAppStatus(user.id);

  if (status.status === 'DISCONNECTED' || status.status === 'ERROR') {
    initWhatsApp(user.id).catch(console.error);
  }

  return NextResponse.json(status);
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await logoutWhatsApp(user.id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
