import { NextResponse } from "next/server";

/**
 * GET /api/datagolf
 *
 * Fetches in-play probabilities from DataGolf's live model page.
 * DataGolf embeds the JSON payload directly in the HTML — we extract it with a
 * string split (the same approach the original Python dashboard used).
 *
 * Returns:
 *   { golfers: { name, cut, top5, win }[] }  — on success
 *   { golfers: null }                          — if unavailable / parse failure
 *
 * Names are returned as "First Last" (DataGolf stores them "Last, First").
 */
export async function GET() {
  try {
    const res = await fetch("https://datagolf.com/live-model/pga-tour", {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json({ golfers: null });
    }

    const html = await res.text();

    // DataGolf embeds the payload as:
    //   response = JSON.parse('<escaped-json>'.replace(/\\/g, ...))
    const OPEN_MARKER = "response = JSON.parse('";
    const CLOSE_MARKER = "'.replace(";

    const openIdx = html.indexOf(OPEN_MARKER);
    if (openIdx === -1) return NextResponse.json({ golfers: null });

    const after = html.slice(openIdx + OPEN_MARKER.length);
    const closeIdx = after.indexOf(CLOSE_MARKER);
    if (closeIdx === -1) return NextResponse.json({ golfers: null });

    const jsonStr = after.slice(0, closeIdx);

    // DataGolf escapes single-quotes inside the string — unescape before parse
    const unescaped = jsonStr.replace(/\\'/g, "'");
    const data = JSON.parse(unescaped) as {
      main?: { name: string; cut: number; top5: number; win: number }[];
    };

    const raw = data.main ?? [];

    const golfers = raw.map((g) => ({
      name: convertName(g.name),
      cut: g.cut,
      top5: g.top5,
      win: g.win,
    }));

    return NextResponse.json({ golfers });
  } catch {
    return NextResponse.json({ golfers: null });
  }
}

/** Convert DataGolf "Last, First" → "First Last" */
function convertName(raw: string): string {
  const parts = raw.split(",");
  if (parts.length < 2) return raw.trim();
  return `${parts[1].trim()} ${parts[0].trim()}`;
}
