import { NextResponse } from "next/server";
import { getClient } from "@/lib/whatsapp";

export async function POST(req: Request) {
  try {
    const { phone, message } = await req.json();

    if (!phone || !message) {
      return NextResponse.json(
        { error: "Phone and message are required" },
        { status: 400 }
      );
    }

    const client = getClient();
    
    if (!client || global.waStatus !== 'READY') {
      return NextResponse.json(
        { error: "WhatsApp Client is not ready. Please scan QR code first." },
        { status: 400 }
      );
    }

    // Format phone number
    let formattedPhone = phone.replace(/\D/g, "");
    
    // Add country code if missing (Assuming India +91 as default)
    if (formattedPhone.length === 10) {
      formattedPhone = `91${formattedPhone}`;
    }
    
    // Append @c.us for whatsapp-web.js format
    const chatId = `${formattedPhone}@c.us`;

    // Send the message using the local puppeteer instance
    const response = await client.sendMessage(chatId, message);

    return NextResponse.json({ success: true, id: response.id._serialized });
  } catch (error: any) {
    console.error("Send message error:", error);
    return NextResponse.json(
      { error: "Failed to send WhatsApp message: " + error.message },
      { status: 500 }
    );
  }
}

