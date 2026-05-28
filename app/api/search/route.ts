import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { location, query, page = 1, pageSize = 20 } = await req.json();

    if (!location || !query) {
      return NextResponse.json(
        { error: "Location and query are required" },
        { status: 400 }
      );
    }

    const settings = await prisma.settings.findUnique({ where: { userId: user.id } });
    const apiKey = settings?.serpApiKey || process.env.SERP_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "SerpAPI key is not configured. Add it in Settings." },
        { status: 400 }
      );
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
    const start = (safePage - 1) * safePageSize;

    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.append("engine", "google_maps");
    url.searchParams.append("q", `${query} in ${location}`);
    url.searchParams.append("api_key", apiKey);
    url.searchParams.append("start", String(start));
    url.searchParams.append("num", String(safePageSize));

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 400 });
    }

    const rawResults = (data.local_results || []) as any[];
    const totalResults =
      data.search_information?.total_results ??
      data.search_metadata?.total_results ??
      data.search_metadata?.total_results_count ??
      null;
    const hasNext =
      Boolean(data.pagination?.next) ||
      (rawResults.length === safePageSize &&
        (typeof totalResults === "number" ? safePage * safePageSize < totalResults : true));

    const created = await Promise.all(
      rawResults.map((r) =>
        prisma.lead.create({
          data: {
            userId: user.id,
            name: r.title || "Unknown",
            address: r.address || "",
            phone: r.phone || "",
            rating: typeof r.rating === "number" ? r.rating : null,
            website: r.website || null,
            source: "Google Maps",
            query,
            location,
          },
        })
      )
    );

    const results = created.map((lead) => ({
      id: lead.id,
      name: lead.name,
      address: lead.address,
      phone: lead.phone,
      rating: lead.rating ?? undefined,
      website: lead.website ?? undefined,
    }));

    return NextResponse.json({
      results,
      totalResults,
      page: safePage,
      pageSize: safePageSize,
      hasNext,
    });
  } catch (error: any) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Failed to search businesses. Please try again." },
      { status: 500 }
    );
  }
}
