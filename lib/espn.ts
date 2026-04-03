/**
 * ESPN Golf Scoring Integration
 *
 * Uses ESPN's unofficial public API to fetch live PGA Tour leaderboard data.
 * This endpoint is widely used and stable but is unofficial — handle errors
 * gracefully and treat the data as best-effort.
 *
 * Server-only: this file must not be imported by client components.
 */

// ---------------------------------------------------------------------------
// Raw ESPN API types
// ---------------------------------------------------------------------------

type EspnStatusType = {
  id: string;
  name: string; // e.g. STATUS_ACTIVE, STATUS_FINAL, STATUS_CUT, STATUS_WD, STATUS_DQ
  description: string;
  detail?: string; // e.g. "F" (finished), "F*72" (in progress)
};

type EspnAthlete = {
  id: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
};

type EspnLinescore = {
  period?: { number: number };
  value: number | string;
};

type EspnCompetitor = {
  id: string;
  athlete: EspnAthlete;
  score?: string; // score to par as string, e.g. "-12", "+4", "E", "CUT", "WD"
  // NOTE: as of 2025+, status is on the competition level, not each competitor.
  // Keep this optional so older-format responses still work.
  status?: {
    type: EspnStatusType;
    period?: number; // current round number
  };
  linescores?: EspnLinescore[];
  statistics?: Array<{ name: string; value: number; displayValue?: string }>;
  order?: number; // leaderboard rank (1-indexed)
};

type EspnCompetitionStatus = {
  period?: number; // current round number (1-indexed)
  type: EspnStatusType;
};

type EspnCompetition = {
  id: string;
  competitors: EspnCompetitor[];
  status?: EspnCompetitionStatus;
};

type EspnEvent = {
  id: string;
  name: string;
  shortName?: string;
  date?: string;
  competitions?: EspnCompetition[];
};

type EspnScoreboard = {
  events?: EspnEvent[];
};

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export type GolferScoreUpdate = {
  /** Exact display name from ESPN — used for fuzzy matching against our DB */
  displayName: string;
  /** Score relative to par as an integer. 0 = even, -12 = 12 under, +4 = 4 over */
  scoreToParInt: number;
  /** Position string: "1", "T3", "CUT", "WD", "DQ", "TBD" */
  position: string;
  madeCut: boolean;
  /** Number of rounds started (0–4) */
  roundsComplete: number;
};

export type EspnSyncResult = {
  eventId: string;
  eventName: string;
  golfers: GolferScoreUpdate[];
  fetchedAt: string;
};

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const CUT_STATUSES = new Set(["STATUS_CUT", "STATUS_WD", "STATUS_DQ", "STATUS_MDF"]);

function didMakeCut(statusName: string): boolean {
  return !CUT_STATUSES.has(statusName);
}

function positionFromStatus(statusName: string): string {
  if (statusName === "STATUS_CUT") return "CUT";
  if (statusName === "STATUS_WD") return "WD";
  if (statusName === "STATUS_DQ") return "DQ";
  return "TBD";
}

// ---------------------------------------------------------------------------
// Score parsing
// ---------------------------------------------------------------------------

function parseScoreToPar(raw: string | undefined): number {
  if (!raw) return 0;
  const trimmed = raw.trim().toUpperCase();
  if (trimmed === "E" || trimmed === "EVEN" || trimmed === "") return 0;
  const n = parseInt(trimmed, 10);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// Name normalisation (for matching against our golfers table)
// ---------------------------------------------------------------------------

export function normalizeGolferName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Event matching
// ---------------------------------------------------------------------------

function scoreKeywords(name: string): string[] {
  const normalized = normalizeGolferName(name);
  // Remove common stop-words that don't distinguish tournaments
  const stopWords = new Set(["the", "pga", "tour", "championship", "open", "of", "at", "in"]);
  return normalized
    .split(" ")
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

function findBestEvent(events: EspnEvent[], tournamentName: string): EspnEvent | null {
  if (!events.length) return null;

  const target = normalizeGolferName(tournamentName);
  const keywords = scoreKeywords(tournamentName);

  // 1. Exact normalized match
  const exact = events.find((e) => normalizeGolferName(e.name) === target);
  if (exact) return exact;

  // 2. Keyword overlap — find event whose name contains the most keywords from ours
  let bestEvent: EspnEvent | null = null;
  let bestScore = 0;

  for (const event of events) {
    const eName = normalizeGolferName(event.name);
    const matches = keywords.filter((kw) => eName.includes(kw)).length;
    if (matches > bestScore) {
      bestScore = matches;
      bestEvent = event;
    }
  }

  if (bestEvent && bestScore > 0) return bestEvent;

  // 3. Fall back to the first (current) event
  return events[0] ?? null;
}

// ---------------------------------------------------------------------------
// Position computation (derive from sorted scores after ESPN data is fetched)
// ---------------------------------------------------------------------------

function computePositions(golfers: GolferScoreUpdate[]): GolferScoreUpdate[] {
  // Separate active players (made cut) from eliminated
  const active = golfers.filter((g) => g.madeCut).sort((a, b) => a.scoreToParInt - b.scoreToParInt);
  const cut = golfers.filter((g) => !g.madeCut);

  const result: GolferScoreUpdate[] = [];

  let i = 0;
  while (i < active.length) {
    const score = active[i].scoreToParInt;
    const tied = active.filter((g) => g.scoreToParInt === score);
    const pos = tied.length > 1 ? `T${i + 1}` : `${i + 1}`;
    for (const g of tied) {
      result.push({ ...g, position: pos });
    }
    i += tied.length;
  }

  for (const g of cut) {
    result.push({ ...g }); // position already set during parse
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

/**
 * Fetch current PGA Tour scores from ESPN and find the best-matching event.
 *
 * @param tournamentName  The name stored on our Tournament record — used to
 *                        fuzzy-match against ESPN's event list.
 */
export async function fetchEspnScores(tournamentName: string): Promise<EspnSyncResult | null> {
  let data: EspnScoreboard;

  try {
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard",
      {
        // No caching — score syncs should always be fresh
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; GolfPoolApp/1.0)",
        },
      },
    );

    if (!res.ok) {
      console.error(`[espn] Scoreboard fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }

    data = (await res.json()) as EspnScoreboard;
  } catch (err) {
    console.error("[espn] Fetch error:", err);
    return null;
  }

  const events = data.events ?? [];
  const event = findBestEvent(events, tournamentName);

  if (!event) {
    console.warn(`[espn] No matching event found for "${tournamentName}"`);
    return null;
  }

  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  // In the updated ESPN API, the current round lives on the competition status
  const competitionPeriod = competition?.status?.period ?? 0;

  const rawGolfers: GolferScoreUpdate[] = competitors.map((c) => {
    // status may be on the competitor (old API) or absent (new API where it
    // lives on the competition object instead).
    const statusName = c.status?.type?.name ?? "";
    const scoreValue = c.score ?? "";

    // Detect CUT/WD/DQ from the per-competitor status field (old API) or from
    // the score string itself (new API encodes "CUT", "WD", "DQ" there).
    const scoreTrimmed = scoreValue.trim().toUpperCase();
    const isCutLike =
      CUT_STATUSES.has(statusName) ||
      scoreTrimmed === "CUT" ||
      scoreTrimmed === "WD" ||
      scoreTrimmed === "DQ" ||
      scoreTrimmed === "MDF";

    const madeCut = !isCutLike;

    const roundsComplete =
      c.linescores?.filter((ls) => {
        const v = typeof ls.value === "string" ? parseFloat(ls.value) : ls.value;
        return typeof v === "number" && !isNaN(v);
      }).length ?? competitionPeriod;

    let position: string;
    if (!madeCut) {
      // Prefer the explicit status name; fall back to the score string (e.g. "CUT")
      position = statusName ? positionFromStatus(statusName) : scoreTrimmed;
    } else {
      position = "TBD";
    }

    return {
      displayName: c.athlete.displayName,
      scoreToParInt: isCutLike ? 0 : parseScoreToPar(scoreValue),
      position,
      madeCut,
      roundsComplete,
    };
  });

  const withPositions = computePositions(rawGolfers);

  return {
    eventId: event.id,
    eventName: event.name,
    golfers: withPositions,
    fetchedAt: new Date().toISOString(),
  };
}
