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
  /** Stroke total for each completed round. null = round not yet played or partial. */
  r1Score: number | null;
  r2Score: number | null;
  r3Score: number | null;
  r4Score: number | null;
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

function parseRoundStroke(ls: EspnLinescore | undefined): number | null {
  if (!ls) return null;
  const v = typeof ls.value === "string" ? parseFloat(ls.value) : ls.value;
  return typeof v === "number" && !isNaN(v) && v > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// Name normalisation (for matching against our golfers table)
// ---------------------------------------------------------------------------

export function normalizeGolferName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Event matching
// ---------------------------------------------------------------------------

function scoreKeywords(name: string): string[] {
  const normalized = normalizeGolferName(name);
  const stopWords = new Set(["the", "tour", "of", "at", "in", "presented", "by", "hosted"]);
  const filtered = normalized.split(" ").filter((w) => w.length > 2 && !stopWords.has(w));
  // If filtering wipes out all keywords (e.g. "PGA Championship"), use everything
  return filtered.length > 0 ? filtered : normalized.split(" ").filter((w) => w.length > 2);
}

function findBestEvent(events: EspnEvent[], tournamentName: string): EspnEvent | null {
  if (!events.length) return null;

  const target = normalizeGolferName(tournamentName);
  const keywords = scoreKeywords(tournamentName);

  // 1. Exact normalized match
  const exact = events.find((e) => normalizeGolferName(e.name) === target);
  if (exact) return exact;

  // 2. Keyword overlap — find event whose name contains the most keywords from ours.
  // Require at least one keyword to match; never fall back to an arbitrary event.
  // (A blind events[0] fallback caused syncs to corrupt finished-tournament scores
  // by matching against the next week's tournament.)
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

  // No match — return null so the caller can fall back gracefully rather than
  // silently syncing the wrong tournament.
  return null;
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
// Core parse logic (shared between live and dated fetches)
// ---------------------------------------------------------------------------

function parseCompetitors(
  competitors: EspnCompetitor[],
  competitionPeriod: number,
): GolferScoreUpdate[] {
  // Derive the effective round from the most rounds any player has completed.
  // ESPN may return period=0 for finished tournaments fetched by event ID, so
  // relying solely on competitionPeriod causes cut detection to silently fail.
  const maxRoundsPlayed = Math.max(
    0,
    ...competitors.map((c) =>
      (c.linescores ?? []).filter((ls) => {
        const v = typeof ls.value === "string" ? parseFloat(ls.value) : ls.value;
        return typeof v === "number" && !isNaN(v) && v > 0;
      }).length,
    ),
  );
  const effectivePeriod = Math.max(competitionPeriod, maxRoundsPlayed);

  // Pre-scan: compute the cut line from players ESPN explicitly marks STATUS_CUT
  // with a numeric score. The minimum score among known-cut players IS the cut line;
  // any other player at or above it also missed the cut. This is always safe —
  // if the cut is at +4, a player at +5 cannot be active regardless of linescore count.
  // We only activate this when effectivePeriod >= 3 (cut has happened).
  let inferredCutLine: number | null = null;
  if (effectivePeriod >= 3) {
    const cutScores: number[] = [];
    for (const c of competitors) {
      const sn = c.status?.type?.name ?? "";
      const st = (c.score ?? "").trim().toUpperCase();
      if (sn === "STATUS_CUT" && !["CUT", "WD", "DQ", "MDF"].includes(st)) {
        cutScores.push(parseScoreToPar(c.score ?? ""));
      }
    }
    if (cutScores.length > 0) inferredCutLine = Math.min(...cutScores);
  }

  const rawGolfers: GolferScoreUpdate[] = competitors.map((c) => {
    const statusName = c.status?.type?.name ?? "";
    const scoreValue = c.score ?? "";
    const scoreTrimmed = scoreValue.trim().toUpperCase();

    // --- Cut detection ---
    const explicitCutLike =
      CUT_STATUSES.has(statusName) ||
      scoreTrimmed === "CUT" ||
      scoreTrimmed === "WD" ||
      scoreTrimmed === "DQ" ||
      scoreTrimmed === "MDF";

    // Infer cut when ESPN hasn't set STATUS_CUT but the player's score is at or
    // above the cut line and they have no current-round data. At the start of a
    // new round ALL players have no current-round data, but inferredCutLine is null
    // until at least one player is officially marked cut, so this stays silent then.
    const validLsCount = (c.linescores ?? []).filter((ls) => {
      const v = typeof ls.value === "string" ? parseFloat(ls.value) : ls.value;
      return typeof v === "number" && !isNaN(v) && v > 0;
    }).length;
    const inferredCut =
      !explicitCutLike &&
      effectivePeriod >= 3 &&
      validLsCount < effectivePeriod &&
      inferredCutLine !== null &&
      parseScoreToPar(scoreValue) >= inferredCutLine;

    const isCutLike = explicitCutLike || inferredCut;
    const madeCut = !isCutLike;

    // --- Rounds complete ---
    const roundsComplete =
      (c.linescores ?? []).filter((ls) => {
        const v = typeof ls.value === "string" ? parseFloat(ls.value) : ls.value;
        return typeof v === "number" && !isNaN(v) && v > 0;
      }).length || competitionPeriod;

    // --- Per-round stroke totals (0-indexed linescore array) ---
    // Only store a round's total when the value is a positive integer stroke count.
    // ESPN fills unplayed rounds with 0 as a placeholder — those become null here.
    const r1Score = parseRoundStroke(c.linescores?.[0]);
    const r2Score = parseRoundStroke(c.linescores?.[1]);
    const r3Score = parseRoundStroke(c.linescores?.[2]);
    const r4Score = parseRoundStroke(c.linescores?.[3]);

    // --- Position ---
    let position: string;
    if (!madeCut) {
      if (statusName) {
        position = positionFromStatus(statusName);
      } else if (scoreTrimmed === "CUT" || scoreTrimmed === "WD" || scoreTrimmed === "DQ" || scoreTrimmed === "MDF") {
        position = scoreTrimmed;
      } else {
        position = "CUT";
      }
    } else {
      position = "TBD";
    }

    const scoreToParInt = parseScoreToPar(scoreValue);

    return {
      displayName: c.athlete.displayName,
      scoreToParInt,
      position,
      madeCut,
      roundsComplete,
      r1Score,
      r2Score,
      r3Score,
      r4Score,
    };
  });

  return computePositions(rawGolfers);
}

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

async function fetchAndParse(url: string, tournamentName: string): Promise<EspnSyncResult | null> {
  let data: EspnScoreboard;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; GolfPoolApp/1.0)",
      },
    });

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
    console.warn(`[espn] No matching event found for "${tournamentName}" in ${events.map(e => e.name).join(", ") || "empty scoreboard"}`);
    return null;
  }

  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const competitionPeriod = competition?.status?.period ?? 0;

  const golfers = parseCompetitors(competitors, competitionPeriod);

  return {
    eventId: event.id,
    eventName: event.name,
    golfers,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main fetch function (current scoreboard)
// ---------------------------------------------------------------------------

/**
 * Fetch current PGA Tour scores from ESPN and find the best-matching event.
 *
 * @param tournamentName  The name stored on our Tournament record — used to
 *                        fuzzy-match against ESPN's event list.
 */
export async function fetchEspnScores(tournamentName: string): Promise<EspnSyncResult | null> {
  return fetchAndParse(
    "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard",
    tournamentName,
  );
}

/**
 * Fetch PGA Tour scores from ESPN's dated scoreboard — used to re-sync
 * historical or recently-finished tournaments that have left the current
 * scoreboard.
 *
 * @param tournamentName  Tournament name for event matching.
 * @param date            Date in YYYYMMDD format (e.g. "20250518" for May 18 2025).
 */
export async function fetchEspnScoresByDate(
  tournamentName: string,
  date: string,
): Promise<EspnSyncResult | null> {
  return fetchAndParse(
    `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=${date}`,
    tournamentName,
  );
}

/**
 * Fetch PGA Tour scores directly by ESPN event ID — the most reliable way to
 * sync a finished tournament since it bypasses name-matching entirely.
 *
 * The ESPN event ID appears in the URL of the event's ESPN page:
 * e.g. https://www.espn.com/golf/leaderboard?tournamentId=401703526  → ID is 401703526
 *
 * @param espnEventId  The numeric ESPN event/tournament ID.
 * @param tournamentName  Tournament name — used only for the returned eventName field.
 */
export async function fetchEspnScoresByEventId(
  espnEventId: string,
  tournamentName: string,
): Promise<EspnSyncResult | null> {
  return fetchAndParse(
    `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?event=${espnEventId}`,
    tournamentName,
  );
}
