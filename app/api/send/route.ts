import { NextResponse } from "next/server";
import { getClient, getWhatsAppStatus } from "@/lib/whatsapp";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const { phone, message, leadId } = body as { phone?: string; message?: string; leadId?: string };

  const markStatus = async (status: "SENT" | "FAILED") => {
    if (!leadId) return;
    await prisma.lead
      .updateMany({ where: { id: leadId, userId: user.id }, data: { status } })
      .catch(() => {});
  };

  try {
    if (!phone || !message) {
      return NextResponse.json(
        { error: "Phone and message are required" },
        { status: 400 }
      );
    }

    const client = getClient(user.id);
    const { status } = getWhatsAppStatus(user.id);

    if (!client || status !== "READY") {
      return NextResponse.json(
        { error: "WhatsApp Client is not ready. Please scan QR code first." },
        { status: 400 }
      );
    }

    let formattedPhone = phone.replace(/\D/g, "");
    if (formattedPhone.length === 10) {
      formattedPhone = `91${formattedPhone}`;
    }
    const chatId = `${formattedPhone}@c.us`;

    const response = await client.sendMessage(chatId, message);
    await markStatus("SENT");
    return NextResponse.json({ success: true, id: response.id._serialized });
  } catch (error: any) {
    console.error("Send message error:", error);
    await markStatus("FAILED");
    return NextResponse.json(
      { error: "Failed to send WhatsApp message: " + error.message },
      { status: 500 }
    );
  }
}
