import { NextResponse } from "next/server";
import { getWhatsAppStatus, initWhatsApp } from "@/lib/whatsapp";

export async function GET() {
  const status = getWhatsAppStatus();

  // If disconnected, trigger initialization in the background
  if (status.status === 'DISCONNECTED' || status.status === 'ERROR') {
    // Fire and forget
    initWhatsApp().catch(console.error);
  }

  return NextResponse.json(status);
}

// Optional endpoint to manually logout/disconnect
export async function POST(req: Request) {
  try {
    const client = global.waClient;
    if (client) {
      await client.logout();
      global.waStatus = 'DISCONNECTED';
      global.waClient = undefined;
      global.waQrCode = null;
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
