import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      onboardedAt: true,
      createdAt: true,
      _count: { select: { leads: true } },
    },
  });

  const leadsByStatus = await prisma.lead.groupBy({
    by: ["userId", "status"],
    _count: { _all: true },
  });

  const breakdown = new Map<string, { sent: number; failed: number; found: number }>();
  for (const row of leadsByStatus) {
    const cur = breakdown.get(row.userId) || { sent: 0, failed: 0, found: 0 };
    if (row.status === "SENT") cur.sent = row._count._all;
    else if (row.status === "FAILED") cur.failed = row._count._all;
    else cur.found += row._count._all;
    breakdown.set(row.userId, cur);
  }

  const totalUsers = users.length;
  const totalLeads = users.reduce((s, u) => s + u._count.leads, 0);
  const totalSent = Array.from(breakdown.values()).reduce((s, b) => s + b.sent, 0);
  const totalFailed = Array.from(breakdown.values()).reduce((s, b) => s + b.failed, 0);

  return NextResponse.json({
    totals: { totalUsers, totalLeads, totalSent, totalFailed },
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      onboarded: !!u.onboardedAt,
      createdAt: u.createdAt,
      leadsTotal: u._count.leads,
      leadsSent: breakdown.get(u.id)?.sent ?? 0,
      leadsFailed: breakdown.get(u.id)?.failed ?? 0,
    })),
  });
}
