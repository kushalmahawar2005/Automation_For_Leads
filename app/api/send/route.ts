import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { sendSingle } from "@/lib/sender";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const { phone, message, leadId } = body as { phone?: string; message?: string; leadId?: string };

  if (!phone || !message) {
    return NextResponse.json({ error: "Phone and message are required" }, { status: 400 });
  }

  const result = await sendSingle(user.id, leadId, phone, message);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
  }
  return NextResponse.json({ success: true, id: result.id });
}
