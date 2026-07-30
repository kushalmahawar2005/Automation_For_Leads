import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const normPhone = (raw: string): string => {
  let d = (raw || "").replace(/\D/g, "");
  if (d.startsWith("0091")) d = d.slice(4);
  else if (d.startsWith("091")) d = d.slice(3);
  else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d;
};

async function scrapeGoogleMapsFallback(query: string, location: string, pageSize: number) {
  try {
    const puppeteer = require("puppeteer");
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined;
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(`${query} in ${location}`)}`;
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await new Promise((r) => setTimeout(r, 3000));

      const items = await page.evaluate((maxCount: number) => {
        const results: any[] = [];
        const elements = Array.from(
          document.querySelectorAll("div[role='feed'] > div, div[role='article'], .Nv2PK, .hfAnN")
        );
        for (const el of elements) {
          if (results.length >= maxCount) break;
          const titleEl = el.querySelector(".qBF1Pd, .fontHeadlineSmall, [role='heading'], .section-result-title");
          const name = titleEl ? titleEl.textContent?.trim() : "";
          if (!name) continue;

          const textContent = el.textContent || "";
          const phoneMatch = textContent.match(/(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}|0\d{10}|\b[6-9]\d{9}\b/);
          const phone = phoneMatch ? phoneMatch[0] : "";

          const ratingEl = el.querySelector(".MW4pbf, [aria-label*='stars'], .MW4pbf + span");
          let rating: number | null = null;
          if (ratingEl) {
            const rMatch = (ratingEl.getAttribute("aria-label") || ratingEl.textContent || "").match(/(\d+(?:\.\d+)?)/);
            if (rMatch) rating = parseFloat(rMatch[1]);
          }

          const websiteEl = el.querySelector("a[href*='http']:not([href*='google.com'])") as HTMLAnchorElement | null;
          const website = websiteEl ? websiteEl.href : null;

          results.push({ name, address: `${location}`, phone, rating, website });
        }
        return results;
      }, pageSize);

      return items;
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    console.error("Puppeteer fallback scraper error:", err);
    return [];
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { location, query, page = 1, pageSize = 20 } = await req.json();

    if (!location || !query) {
      return NextResponse.json(
        { error: "Location and category/query are required" },
        { status: 400 }
      );
    }

    const settings = await prisma.settings.findUnique({ where: { userId: user.id } });
    const apiKey = settings?.serpApiKey || process.env.SERP_API_KEY;

    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
    const start = (safePage - 1) * safePageSize;

    let rawResults: any[] = [];
    let totalResults: number | null = null;
    let hasNext = false;
    let serpError: string | null = null;

    if (apiKey && apiKey.trim() !== "") {
      try {
        const url = new URL("https://serpapi.com/search.json");
        url.searchParams.append("engine", "google_maps");
        url.searchParams.append("q", `${query} in ${location}`);
        url.searchParams.append("api_key", apiKey.trim());
        url.searchParams.append("start", String(start));
        url.searchParams.append("num", String(safePageSize));

        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.error) {
          serpError = data.error;
        } else {
          rawResults = (data.local_results || data.places_results || data.place_results || data.organic_results || []) as any[];
          totalResults =
            data.search_information?.total_results ??
            data.search_metadata?.total_results ??
            data.search_metadata?.total_results_count ??
            null;
          hasNext =
            Boolean(data.pagination?.next) ||
            (rawResults.length === safePageSize &&
              (typeof totalResults === "number" ? safePage * safePageSize < totalResults : true));
        }
      } catch (err: any) {
        serpError = err.message || "Failed SerpAPI request";
      }
    }

    // Fallback to Puppeteer Google Maps Scraper if SerpAPI key is missing, errored, or returned 0 results
    if (rawResults.length === 0) {
      console.log(`SerpAPI returned 0 results or not configured (${serpError || "No key"}). Running Puppeteer fallback scraper...`);
      const fallbackResults = await scrapeGoogleMapsFallback(query, location, safePageSize);
      if (fallbackResults.length > 0) {
        rawResults = fallbackResults;
        hasNext = false;
      } else if (!apiKey && serpError) {
        return NextResponse.json({ error: serpError }, { status: 400 });
      }
    }

    // Pre-load this user's existing phone numbers so we skip duplicates
    const existing = await prisma.lead.findMany({
      where: { userId: user.id, phone: { not: "" } },
      select: { phone: true },
    });
    const seenPhones = new Set(existing.map((l) => normPhone(l.phone)));

    const results: {
      id: string;
      name: string;
      address: string;
      phone: string;
      rating?: number;
      website?: string;
    }[] = [];
    let newCount = 0;
    let duplicateCount = 0;

    for (const r of rawResults) {
      const phone = r.phone || r.phone_number || r.unformatted_phone || "";
      const key = normPhone(phone);

      if (phone && seenPhones.has(key)) {
        duplicateCount++;
        continue;
      }
      if (phone) seenPhones.add(key);

      const lead = await prisma.lead.create({
        data: {
          userId: user.id,
          name: r.title || r.name || "Unknown",
          address: r.address || r.formatted_address || location || "",
          phone,
          rating: typeof r.rating === "number" ? r.rating : (parseFloat(r.rating) || null),
          website: r.website || r.link || null,
          source: "Google Maps",
          query,
          location,
        },
      });
      newCount++;

      results.push({
        id: lead.id,
        name: lead.name,
        address: lead.address,
        phone: lead.phone,
        rating: lead.rating ?? undefined,
        website: lead.website ?? undefined,
      });
    }

    return NextResponse.json({
      results,
      totalResults: totalResults ?? results.length,
      newCount,
      duplicateCount,
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
