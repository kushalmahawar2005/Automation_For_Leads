import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildTablePdf } from "@/lib/pdf";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUS = new Set(["FOUND", "SENT", "FAILED", "INVALID"]);
const MAX_EXPORT = 2000;

// Export the user's leads (company name / phone / location) as a PDF.
// `limit` is chosen by the user — that's the whole point of the option.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
    const status: string | undefined = body.status;
    const onlyWithPhone = body.onlyWithPhone !== false; // default: skip leads with no number
    const take = Math.min(MAX_EXPORT, Math.max(1, Number(body.limit) || 50));

    const where: Prisma.LeadWhereInput = { userId: user.id };
    if (ids.length > 0) where.id = { in: ids };
    else if (status && VALID_STATUS.has(status)) where.status = status;
    if (onlyWithPhone) where.phone = { not: "" };

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: { name: true, phone: true, address: true, location: true, query: true, status: true },
    });

    if (leads.length === 0) {
      return NextResponse.json({ error: "No leads match this export." }, { status: 404 });
    }

    const category = leads[0].query || "";
    const area = leads[0].location || "";
    const generated = new Date().toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    });

    const subtitleBits = [
      category && `Category: ${category}`,
      area && `Location: ${area}`,
      status && VALID_STATUS.has(status) ? `Status: ${status}` : null,
      `${leads.length} record${leads.length === 1 ? "" : "s"}`,
      `Generated ${generated}`,
    ].filter(Boolean) as string[];

    const pdf = buildTablePdf({
      title: "Business Leads Export",
      subtitle: subtitleBits.join("  |  "),
      columns: [
        { header: "#", weight: 0.06, align: "right" },
        { header: "Company Name", weight: 0.38 },
        { header: "Phone", weight: 0.22 },
        { header: "Location", weight: 0.34 },
      ],
      rows: leads.map((l, i) => [
        String(i + 1),
        l.name || "Unknown",
        l.phone || "-",
        l.address || l.location || "-",
      ]),
      footerNote: `${user.email} - Kushal Automation`,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const slug = (category || "leads").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${slug || "leads"}-${leads.length}-${stamp}.pdf"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Lead export error:", error);
    return NextResponse.json({ error: "Failed to generate PDF." }, { status: 500 });
  }
}
