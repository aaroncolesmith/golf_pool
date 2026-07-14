import "server-only";

// Action Network PGA odds are embedded server-side in the page's __NEXT_DATA__
// blob — no API key or client-side execution needed.

type ANCompetitor = {
  id: number;
  full_name: string;
};

type ANMarketEntry = {
  competitor_id: number;
  odds: number; // American odds integer, e.g. 750 = +750
};

type ANCompetition = {
  status: string;
  competitors: ANCompetitor[];
  markets: Record<
    string, // book_id
    { event?: { moneyline?: ANMarketEntry[] } }
  >;
};

type ANNextData = {
  props?: {
    pageProps?: {
      scoreboardResponse?: {
        competitions?: ANCompetition[];
      };
    };
  };
};

export type ActionNetworkOdds = {
  /** Normalized player name (lowercase, diacritics stripped) → American odds */
  oddsMap: Map<string, number>;
};

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch PGA Tour tournament winner (moneyline) odds from Action Network.
 * Returns an oddsMap keyed by normalized player name.
 * Throws if the page is inaccessible or its structure has changed.
 */
export async function getActionNetworkPgaOdds(): Promise<ActionNetworkOdds> {
  const res = await fetch("https://www.actionnetwork.com/pga/odds", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Action Network fetch failed: ${res.status}`);
  }

  const html = await res.text();
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) {
    throw new Error("Action Network page structure changed: __NEXT_DATA__ not found");
  }

  const nextData = JSON.parse(match[1]) as ANNextData;
  const competitions =
    nextData?.props?.pageProps?.scoreboardResponse?.competitions ?? [];

  // Pick the competition whose best book has the most moneyline entries —
  // that's the main tournament field (not a side-event or alternate field).
  let bestComp: ANCompetition | null = null;
  let bestCount = 0;

  for (const comp of competitions) {
    for (const bookData of Object.values(comp.markets ?? {})) {
      const ml = bookData?.event?.moneyline ?? [];
      if (ml.length > bestCount) {
        bestCount = ml.length;
        bestComp = comp;
      }
    }
  }

  if (!bestComp || bestCount === 0) {
    return { oddsMap: new Map() };
  }

  const nameById = new Map<number, string>(
    (bestComp.competitors ?? []).map((c) => [c.id, c.full_name]),
  );

  // Pick the book with the most moneyline entries for this competition
  let bestBook: ANMarketEntry[] = [];
  for (const bookData of Object.values(bestComp.markets ?? {})) {
    const ml = bookData?.event?.moneyline ?? [];
    if (ml.length > bestBook.length) bestBook = ml;
  }

  const oddsMap = new Map<string, number>();
  for (const entry of bestBook) {
    const name = nameById.get(entry.competitor_id);
    if (name && entry.odds > 0) {
      oddsMap.set(normalizeName(name), entry.odds);
    }
  }

  return { oddsMap };
}
