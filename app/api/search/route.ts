import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { location, query } = await req.json();
    const apiKey = process.env.SERP_API_KEY;

    if (!location || !query) {
      return NextResponse.json(
        { error: "Location and query are required" },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: "SERP_API_KEY is not configured in the .env file" },
        { status: 500 }
      );
    }

    // Use SerpAPI Google Maps API
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.append("engine", "google_maps");
    url.searchParams.append("q", `${query} in ${location}`);
    url.searchParams.append("api_key", apiKey);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 400 });
    }

    // Format results
    const results = (data.local_results || []).map((result: any, index: number) => ({
      id: `business_${index}_${Date.now()}`,
      name: result.title,
      address: result.address,
      phone: result.phone || "",
      rating: result.rating,
      website: result.website,
    }));

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Failed to search businesses. Please try again." },
      { status: 500 }
    );
  }
}
