import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/draftkings-odds?leagueId=XXXX
 *
 * Fetches live betting odds from the DraftKings Sportsbook API for a
 * given golf tournament league.  Returns implied probabilities (0-1) for
 * four markets per golfer:
 *   cut    – To Make the Cut
 *   top10  – Top 10 Finish (Including Ties)
 *   top5   – Top 5 Finish (Including Ties)
 *   win    – Outright Winner
 *
 * Returns:
 *   { golfers: DKOddsGolfer[] }  on success
 *   { golfers: null }             if unavailable / parse failure
 */

const DK_API_BASE =
  "https://sportsbook-nash.draftkings.com/sites/US-OR-SB/api/sportscontent/controldata";

// Subcategory IDs to try for each market group.
// DraftKings groups markets by subcategory; we fetch each group and look for
// the named markets within the response.
const WINNER_SUBCATEGORY_IDS = ["4508"];
const CUT_SUBCATEGORY_IDS = ["14417", "12382", "4513"];

export type DKOddsGolfer = {
  name: string;
  cut: number | null;   // implied probability 0-1
  top5: number | null;
  top10: number | null;
  win: number | null;
};

// ---------------------------------------------------------------------------
// DraftKings API helpers (mirrored from lib/draftkings.ts but runnable from
// the API route without importing the "server-only" module directly)
// ---------------------------------------------------------------------------

type DKMarketsResponse = {
  markets?: Array<{
    id?: string;
    name?: string;
    subcategoryId?: string;
    marketType?: { name?: string };
  }>;
  selections?: Array<{
    marketId?: string;
    label?: string;
    displayOdds?: { american?: string };
  }>;
};

function buildMarketsUrl(leagueId: string, subcategoryId: string): string {
  const params = new URLSearchParams({
    isBatchable: "false",
    templateVars: `${leagueId},${subcategoryId}`,
    eventsQuery: `$filter=leagueId eq '${leagueId}' AND clientMetadata/Subcategories/any(s: s/Id eq '${subcategoryId}')`,
    marketsQuery: `$filter=clientMetadata/subCategoryId eq '${subcategoryId}' AND tags/all(t: t ne 'SportcastBetBuilder')`,
    include: "Events",
    entity: "events",
  });
  return `${DK_API_BASE}/league/leagueSubcategory/v1/markets?${params.toString()}`;
}

async function fetchMarkets(
  leagueId: string,
  subcategoryId: string,
): Promise<DKMarketsResponse | null> {
  try {
    const url = buildMarketsUrl(leagueId, subcategoryId);
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        accept: "application/json,text/plain,*/*",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as DKMarketsResponse;
  } catch {
    return null;
  }
}

function parseAmerican(value?: string): number | null {
  if (!value) return null;
  const n = parseInt(value.replace(/[^\d+-]/g, ""), 10);
  return isNaN(n) ? null : n;
}

function americanToProb(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function marketMatches(name: string, ...patterns: string[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

/**
 * Find a market in the payload whose name matches any of the given patterns,
 * then return a map of golfer name → implied probability for that market.
 */
function extractMarketProbs(
  payload: DKMarketsResponse,
  ...namePatterns: string[]
): Map<string, number> {
  const result = new Map<string, number>();
  if (!payload.markets || !payload.selections) return result;

  const market = payload.markets.find(
    (m) =>
      marketMatches(m.name ?? "", ...namePatterns) ||
      marketMatches(m.marketType?.name ?? "", ...namePatterns),
  );
  if (!market?.id) return result;

  for (const sel of payload.selections) {
    if (sel.marketId !== market.id) continue;
    const name = sel.label?.trim();
    if (!name) continue;
    const american = parseAmerican(sel.displayOdds?.american);
    if (american === null) continue;
    result.set(name, americanToProb(american));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const leagueId = req.nextUrl.searchParams.get("leagueId");
  if (!leagueId) {
    return NextResponse.json({ golfers: null });
  }

  try {
    // --- Fetch winner subcategory (4508) -----------------------------------
    // This often contains Outright Winner, Top 5, Top 10 markets.
    let winnerPayload: DKMarketsResponse | null = null;
    for (const sid of WINNER_SUBCATEGORY_IDS) {
      winnerPayload = await fetchMarkets(leagueId, sid);
      if (winnerPayload?.markets?.length) break;
    }

    // --- Fetch cut subcategory (try several known IDs) ---------------------
    let cutPayload: DKMarketsResponse | null = null;
    for (const sid of CUT_SUBCATEGORY_IDS) {
      const payload = await fetchMarkets(leagueId, sid);
      if (payload?.markets?.length) {
        // Verify it has a cut-related market before accepting
        const hasCut = payload.markets.some((m) =>
          marketMatches(m.name ?? "", "cut", "make cut", "make the cut"),
        );
        if (hasCut) {
          cutPayload = payload;
          break;
        }
        // Also accept if it has any markets (maybe DK labels it differently)
        if (!cutPayload) cutPayload = payload;
      }
    }

    // --- Extract probability maps per market --------------------------------
    const winMap =
      winnerPayload ? extractMarketProbs(winnerPayload, "winner", "outright") : new Map<string, number>();
    const top5Map =
      winnerPayload ? extractMarketProbs(winnerPayload, "top 5", "top5") : new Map<string, number>();
    const top10Map =
      winnerPayload ? extractMarketProbs(winnerPayload, "top 10", "top10") : new Map<string, number>();
    const cutMap =
      cutPayload
        ? extractMarketProbs(cutPayload, "cut", "make cut", "make the cut")
        : new Map<string, number>();

    // If the winner subcategory didn't have top5/top10, try the cut payload
    if (top5Map.size === 0 && cutPayload) {
      const fallback = extractMarketProbs(cutPayload, "top 5", "top5");
      fallback.forEach((v, k) => top5Map.set(k, v));
    }
    if (top10Map.size === 0 && cutPayload) {
      const fallback = extractMarketProbs(cutPayload, "top 10", "top10");
      fallback.forEach((v, k) => top10Map.set(k, v));
    }

    // --- Merge into unified golfer list -------------------------------------
    // Use the largest map as the base set of golfer names.
    const nameSet = new Set<string>([
      ...winMap.keys(),
      ...top5Map.keys(),
      ...top10Map.keys(),
      ...cutMap.keys(),
    ]);

    if (nameSet.size === 0) {
      console.warn("[draftkings-odds] No golfers found for leagueId:", leagueId);
      return NextResponse.json({ golfers: null });
    }

    const golfers: DKOddsGolfer[] = Array.from(nameSet).map((name) => ({
      name,
      cut: cutMap.get(name) ?? null,
      top5: top5Map.get(name) ?? null,
      top10: top10Map.get(name) ?? null,
      win: winMap.get(name) ?? null,
    }));

    // Sort by win probability descending (favourites first)
    golfers.sort(
      (a, b) => (b.win ?? b.cut ?? 0) - (a.win ?? a.cut ?? 0),
    );

    return NextResponse.json({ golfers });
  } catch (err) {
    console.error("[draftkings-odds] Unhandled error:", err);
    return NextResponse.json({ golfers: null });
  }
}
