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
    const { userId: _ignored, ...safe } = data;
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
