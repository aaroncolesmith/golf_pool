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

// Same normalization as ESPN's normalizeGolferName — keeps hyphens and apostrophes,
// and explicitly maps characters that don't decompose under NFD (ø, æ, etc.)
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/ð/g, "d")
    .replace(/þ/g, "th")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Static DraftKings fallback — 2026 Open Championship outright winner odds.
// Used for players not priced in Action Network's moneyline market.
// Source: DraftKings sportsbook, pasted 2026-07-14.
// ---------------------------------------------------------------------------
const OPEN_2026_DK_FALLBACK: Record<string, number> = {
  "scottie scheffler": 650,
  "rory mcilroy": 840,
  "matt fitzpatrick": 1800,
  "tommy fleetwood": 1900,
  "jon rahm": 1950,
  "xander schauffele": 2400,
  "chris gotterup": 2900,
  "cameron young": 3000,
  "ludvig aberg": 3200,
  "collin morikawa": 3300,
  "viktor hovland": 3400,
  "robert macintyre": 3600,
  "tyrrell hatton": 3800,
  "wyndham clark": 3900,
  "justin rose": 4100,
  "sam burns": 4500,
  "si woo kim": 4600,
  "joaquin niemann": 5200,
  "russell henley": 5400,
  "bryson dechambeau": 5600,
  "justin thomas": 5600,
  "tom kim": 5600,
  "brooks koepka": 5700,
  "patrick cantlay": 5700,
  "shane lowry": 5800,
  "min woo lee": 5800,
  "patrick reed": 6300,
  "alex fitzpatrick": 6700,
  "aaron rai": 6800,
  "jj spaun": 7200,
  "jordan spieth": 8000,
  "kurt kitayama": 8200,
  "nicolai hojgaard": 8800,
  "ben griffin": 9000,
  "rickie fowler": 9600,
  "hideki matsuyama": 9800,
  "adam scott": 10000,
  "kristoffer reitan": 10500,
  "harris english": 10500,
  "maverick mcnealy": 11000,
  "akshay bhatia": 12000,
  "michael thorbjornsen": 12500,
  "alex noren": 12500,
  "brian harman": 12500,
  "corey conners": 13000,
  "cameron smith": 13000,
  "eugenio chacarra": 14500,
  "victor perez": 15000,
  "keegan bradley": 15000,
  "ryan gerard": 15000,
  "jason day": 16000,
  "keith mitchell": 16000,
  "max homa": 17000,
  "eric cole": 17000,
  "jt poston": 17500,
  "gary woodland": 17500,
  "david puig": 17500,
  "ryan fox": 17500,
  "matt wallace": 18000,
  "tom mckibbin": 18000,
  "harry hall": 18500,
  "jordan smith": 19000,
  "jake knapp": 19000,
  "bud cauley": 19500,
  "sahith theegala": 20000,
  "marco penge": 21000,
  "haotong li": 21000,
  "alex smalley": 21000,
  "sepp straka": 21000,
  "jacob bridgeman": 21000,
  "sungjae im": 22000,
  "max greyserman": 22500,
  "thomas detry": 23000,
  "aldrich potgieter": 23000,
  "ryo hisatsune": 23000,
  "john keefer": 24000,
  "andrew novak": 24000,
  "michael brennan": 24000,
  "angel ayora": 24000,
  "jackson suber": 25000,
  "nick taylor": 25000,
  "daniel berger": 27500,
  "lucas herbert": 28000,
  "pierceson coody": 28000,
  "jayden schaper": 29000,
  "rasmus hojgaard": 30000,
  "rasmus neergaard-petersen": 31000,
  "sam stevens": 31000,
  "michael kim": 32500,
  "matt mccarty": 33000,
  "casey jarvis": 34000,
  "sami valimaki": 35000,
  "daniel hillier": 37500,
  "jesper svensson": 39000,
  "john parry": 39000,
  "bernd wiesberger": 39000,
  "matthew jordan": 39000,
  "nicolas echavarria": 41000,
  "laurie canter": 42000,
  "keita nakajima": 45000,
  "scott vincent": 46000,
  "daniel brown": 49000,
  "jose luis ballester": 49000,
  "billy horschel": 49000,
  "hennie du plessis": 50000,
  "adrien saddier": 55000,
  "francesco molinari": 65000,
  "stewart cink": 65000,
  "andy sullivan": 67500,
  "padraig harrington": 67500,
  "antoine rozner": 72500,
  "kota kaneko": 75000,
  "martin couvra": 85000,
  "dan bradbury": 87500,
  "shaun norris": 105000,
  "joe dean": 105000,
  "francesco laporta": 115000,
  "mj daffue": 120000,
  "alistair docherty": 135000,
  "caleb surratt": 140000,
  "joakim lagergren": 150000,
  "frederic lacroix": 150000,
  "kazuma kobori": 150000,
  "peter uihlein": 160000,
  "henrik stenson": 190000,
  "james nicholas": 200000,
  "sam bairstow": 200000,
  "michael hollick": 200000,
  "tim wiedemeyer": 225000,
  "ren yonezawa": 225000,
  "kazuki higa": 225000,
  "matthew southgate": 250000,
  "travis smyth": 275000,
  "stuart grehan": 350000,
  "ryutaro nagano": 350000,
  "austen truslow": 350000,
  "matthew baldwin": 400000,
  "lev grinberg": 400000,
  "jiho yang": 450000,
  "jack mcdonald": 450000,
  "naoyuki kataoka": 450000,
  "jack buchanan": 450000,
  "fifa laopakdee": 500000,
  "david howard": 500000,
  "baard skogen": 500000,
  "alejandro de castro piera": 500000,
  "tom sloman": 500000,
  "nevill ruiter": 500000,
  "mateo pulcini": 500000,
  "marcus plunkett": 500000,
  "darren clarke": 500000,
  "tiger christensen": 500000,
  "mason howell": 500000,
  "david duval": 500000,
  "cameron john": 500000,
  // Name aliases — ESPN uses different names than DraftKings for these players
  "josele ballester": 49000,       // DK: "jose luis ballester"
  "thomas sloman": 500000,         // DK: "tom sloman"
  "johnny keefer": 24000,          // DK: "john keefer"
  "nico echavarria": 41000,        // DK: "nicolas echavarria"
  "bard bjornevik skogen": 500000, // DK: "baard skogen"
};

/**
 * Fetch PGA Tour tournament winner (moneyline) odds from Action Network.
 * Players missing from Action Network's market are filled from the static
 * DraftKings Open 2026 fallback. AN odds always take priority.
 * Returns an oddsMap keyed by normalized player name.
 */
export async function getActionNetworkPgaOdds(): Promise<ActionNetworkOdds> {
  // Seed with DK fallback, then overwrite with fresher AN odds where available.
  const oddsMap = new Map<string, number>(
    Object.entries(OPEN_2026_DK_FALLBACK),
  );

  try {
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

    if (!res.ok) throw new Error(`Action Network fetch failed: ${res.status}`);

    const html = await res.text();
    const match = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
    );
    if (!match) throw new Error("__NEXT_DATA__ not found");

    const nextData = JSON.parse(match[1]) as ANNextData;
    const competitions =
      nextData?.props?.pageProps?.scoreboardResponse?.competitions ?? [];

    // Pick the competition whose best book has the most moneyline entries.
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

    if (bestComp && bestCount > 0) {
      const nameById = new Map<number, string>(
        (bestComp.competitors ?? []).map((c) => [c.id, c.full_name]),
      );

      let bestBook: ANMarketEntry[] = [];
      for (const bookData of Object.values(bestComp.markets ?? {})) {
        const ml = bookData?.event?.moneyline ?? [];
        if (ml.length > bestBook.length) bestBook = ml;
      }

      // AN odds overwrite the DK fallback where available
      for (const entry of bestBook) {
        const name = nameById.get(entry.competitor_id);
        if (name && entry.odds > 0) {
          oddsMap.set(normalizeName(name), entry.odds);
        }
      }
    }
  } catch {
    // AN unavailable — DK fallback still in oddsMap, continue
  }

  return { oddsMap };
}
