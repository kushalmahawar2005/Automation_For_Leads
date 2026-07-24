import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const templates = await prisma.messageTemplate.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ templates });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { id, name, body: templateBody, language } = body as {
    id?: string;
    name?: string;
    body?: string;
    language?: string;
  };

  if (!name?.trim() || !templateBody?.trim()) {
    return NextResponse.json({ error: "Name and body are required." }, { status: 400 });
  }
  const lang = language === "HINGLISH" ? "HINGLISH" : "EN";

  // Update existing (ownership-checked) or create new.
  if (id) {
    const owned = await prisma.messageTemplate.findFirst({ where: { id, userId: user.id } });
    if (!owned) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    const template = await prisma.messageTemplate.update({
      where: { id },
      data: { name: name.trim(), body: templateBody, language: lang },
    });
    return NextResponse.json({ template });
  }

  const template = await prisma.messageTemplate.create({
    data: { userId: user.id, name: name.trim(), body: templateBody, language: lang },
  });
  return NextResponse.json({ template });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await prisma.messageTemplate.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ deleted: true });
}
