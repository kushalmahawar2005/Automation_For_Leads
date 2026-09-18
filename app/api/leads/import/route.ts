import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 2000;

const normPhone = (raw: string): string => {
  let d = (raw || "").replace(/\D/g, "");
  if (d.startsWith("0091")) d = d.slice(4);
  else if (d.startsWith("091")) d = d.slice(3);
  else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d;
};

// Header keywords used to auto-detect which sheet column holds which field.
const COLUMN_HINTS: Record<"name" | "phone" | "address" | "website" | "rating", string[]> = {
  name: ["company", "business", "name", "shop", "firm", "title"],
  phone: ["phone", "mobile", "whatsapp", "contact", "number", "cell", "tel"],
  address: ["address", "location", "city", "area"],
  website: ["website", "site", "url", "web", "link"],
  rating: ["rating", "stars"],
};

// Build the CSV export URL ourselves so we only ever fetch from Google.
function toCsvExportUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.hostname !== "docs.google.com") return null;
  const id = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!id) return null;
  const gid = url.searchParams.get("gid") || url.hash.match(/gid=(\d+)/)?.[1] || "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

// RFC 4180-style parser: handles quoted fields, escaped quotes and newlines inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function detectColumns(header: string[]) {
  const cols: Partial<Record<keyof typeof COLUMN_HINTS, number>> = {};
  const lower = header.map((h) => h.trim().toLowerCase());
  // Phone first so "Contact Number" isn't claimed as a name column. Hints are
  // tried in priority order, so a "Phone" column beats a "Contact Person" one.
  for (const field of ["phone", "website", "rating", "address", "name"] as const) {
    for (const hint of COLUMN_HINTS[field]) {
      const idx = lower.findIndex((h, i) => !Object.values(cols).includes(i) && h.includes(hint));
      if (idx !== -1) {
        cols[field] = idx;
        break;
      }
    }
  }
  return cols;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sheetUrl } = await req.json().catch(() => ({}));
  const csvUrl = typeof sheetUrl === "string" ? toCsvExportUrl(sheetUrl) : null;
  if (!csvUrl) {
    return NextResponse.json(
      { error: "Valid Google Sheet link daalo (docs.google.com/spreadsheets/d/...)" },
      { status: 400 }
    );
  }

  let text: string;
  try {
    const res = await fetch(csvUrl, { redirect: "follow", cache: "no-store" });
    const type = res.headers.get("content-type") || "";
    // Private sheets redirect to a Google login page (HTML) instead of CSV.
    if (!res.ok || !type.includes("text/csv")) {
      return NextResponse.json(
        { error: "Sheet access nahi hua. Share → 'Anyone with the link' → Viewer set karo." },
        { status: 400 }
      );
    }
    text = await res.text();
  } catch {
    return NextResponse.json({ error: "Google Sheet fetch failed. Try again." }, { status: 502 });
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    return NextResponse.json({ error: "Sheet khaali hai — header row + data chahiye." }, { status: 400 });
  }

  const cols = detectColumns(rows[0]);
  if (cols.phone === undefined) {
    return NextResponse.json(
      { error: "Phone column nahi mila. Header me 'Phone' / 'Mobile' / 'Number' likho." },
      { status: 400 }
    );
  }

  const cell = (r: string[], i: number | undefined) => (i === undefined ? "" : (r[i] || "").trim());

  const existing = await prisma.lead.findMany({
    where: { userId: user.id, phone: { not: "" } },
    select: { phone: true },
  });
  const seenPhones = new Set(existing.map((l) => normPhone(l.phone)));

  const dataRows = rows.slice(1, MAX_ROWS + 1);
  const toCreate: {
    userId: string;
    name: string;
    address: string;
    phone: string;
    rating: number | null;
    website: string | null;
    source: string;
    query: string;
    location: string;
  }[] = [];
  let duplicateCount = 0;
  let skippedCount = 0;

  for (const r of dataRows) {
    const phone = cell(r, cols.phone);
    const key = normPhone(phone);
    if (key.length < 10) {
      skippedCount++;
      continue;
    }
    if (seenPhones.has(key)) {
      duplicateCount++;
      continue;
    }
    seenPhones.add(key);

    const address = cell(r, cols.address);
    const rating = parseFloat(cell(r, cols.rating));
    toCreate.push({
      userId: user.id,
      name: cell(r, cols.name) || "Unknown",
      address,
      phone,
      rating: Number.isFinite(rating) ? rating : null,
      website: cell(r, cols.website) || null,
      source: "Google Sheet",
      query: "Sheet import",
      location: address,
    });
  }

  const created = toCreate.length
    ? await prisma.lead.createManyAndReturn({ data: toCreate })
    : [];

  return NextResponse.json({
    results: created.map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address,
      phone: l.phone,
      rating: l.rating ?? undefined,
      website: l.website ?? undefined,
      status: l.status,
    })),
    newCount: created.length,
    duplicateCount,
    skippedCount,
    truncated: rows.length - 1 > MAX_ROWS,
    detectedColumns: Object.fromEntries(
      Object.entries(cols).map(([field, idx]) => [field, rows[0][idx as number]])
    ),
  });
}
