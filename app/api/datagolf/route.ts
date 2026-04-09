import { NextResponse } from "next/server";

/**
 * GET /api/datagolf
 *
 * Returns in-play model probabilities from DataGolf.
 *
 * Strategy (in order):
 *   1. Official API  — if DATAGOLF_API_KEY is set, use the feeds.datagolf.com
 *      endpoint. Reliable from serverless/Vercel environments.
 *   2. HTML scrape   — fetch the live-model page and extract the embedded JSON.
 *      Works locally but may be blocked by Cloudflare on server deployments.
 *
 * Returns:
 *   { golfers: { name, cut, top10, top5, win }[] }  — on success
 *   { golfers: null }                                — if unavailable / parse failure
 *
 * Names are returned as "First Last" (DataGolf stores them "Last, First").
 */

const API_KEY = process.env.DATAGOLF_API_KEY;

export async function GET() {
  const golfers = API_KEY
    ? await fetchViaApi(API_KEY)
    : await fetchViaScrape();

  return NextResponse.json({ golfers });
}

// ---------------------------------------------------------------------------
// Strategy 1: official DataGolf feeds API
// ---------------------------------------------------------------------------

type DGApiPlayer = {
  player_name: string; // "Last, First"
  make_cut?: number;
  top_5?: number;
  top_10?: number;
  win?: number;
};

async function fetchViaApi(key: string) {
  try {
    const url = `https://feeds.datagolf.com/preds/in-play?tour=pga&dead_heat=no&odds_format=decimal&file_format=json&key=${key}`;
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { players?: DGApiPlayer[] };
    const players = data.players ?? [];
    if (!players.length) return null;

    return players.map((p) => ({
      name: convertName(p.player_name),
      cut: p.make_cut ?? 0,
      top10: p.top_10 ?? 0,
      top5: p.top_5 ?? 0,
      win: p.win ?? 0,
    }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Strategy 2: HTML scrape (works locally, may be blocked on Vercel)
// ---------------------------------------------------------------------------

async function fetchViaScrape() {
  try {
    const res = await fetch("https://datagolf.com/live-model/pga-tour", {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const html = await res.text();

    // DataGolf embeds the payload as:
    //   response = JSON.parse('<escaped-json>'.replace(/\\/g, ...))
    const OPEN_MARKER = "response = JSON.parse('";
    const CLOSE_MARKER = "'.replace(";

    const openIdx = html.indexOf(OPEN_MARKER);
    if (openIdx === -1) return null;

    const after = html.slice(openIdx + OPEN_MARKER.length);
    const closeIdx = after.indexOf(CLOSE_MARKER);
    if (closeIdx === -1) return null;

    const jsonStr = after.slice(0, closeIdx);
    const unescaped = jsonStr.replace(/\\'/g, "'");
    const data = JSON.parse(unescaped) as {
      main?: { name: string; cut: number; top5: number; top10: number; win: number }[];
    };

    const raw = data.main ?? [];
    if (!raw.length) return null;

    return raw.map((g) => ({
      name: convertName(g.name),
      cut: g.cut,
      top10: g.top10,
      top5: g.top5,
      win: g.win,
    }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert DataGolf "Last, First" → "First Last" */
function convertName(raw: string): string {
  const parts = raw.split(",");
  if (parts.length < 2) return raw.trim();
  return `${parts[1].trim()} ${parts[0].trim()}`;
}
