import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUS = new Set(["FOUND", "SENT", "FAILED", "INVALID"]);

// List leads with optional status filter + status counts for the tabs.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const q = searchParams.get("q")?.trim();
  const take = Math.min(500, Math.max(1, Number(searchParams.get("take")) || 200));

  const where: Prisma.LeadWhereInput = { userId: user.id };
  if (status && VALID_STATUS.has(status)) where.status = status;
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { phone: { contains: q } },
      { address: { contains: q } },
    ];
  }

  const [leads, grouped] = await Promise.all([
    prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, take }),
    prisma.lead.groupBy({ by: ["status"], where: { userId: user.id }, _count: { _all: true } }),
  ]);

  const counts: Record<string, number> = { FOUND: 0, SENT: 0, FAILED: 0, INVALID: 0, ALL: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.ALL += g._count._all;
  }

  return NextResponse.json({
    counts,
    leads: leads.map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address,
      phone: l.phone,
      rating: l.rating ?? undefined,
      website: l.website ?? undefined,
      status: l.status,
      lastContactedAt: l.lastContactedAt,
      lastError: l.lastError,
      location: l.location,
    })),
  });
}

// Delete leads (single id or clear a status bucket).
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const status = searchParams.get("status");

  if (id) {
    await prisma.lead.deleteMany({ where: { id, userId: user.id } });
    return NextResponse.json({ deleted: true });
  }
  if (status && VALID_STATUS.has(status)) {
    const res = await prisma.lead.deleteMany({ where: { userId: user.id, status } });
    return NextResponse.json({ deleted: res.count });
  }
  return NextResponse.json({ error: "id or status required" }, { status: 400 });
}
