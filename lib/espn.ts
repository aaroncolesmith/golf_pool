/**
 * ESPN Golf Scoring Integration
 *
 * Uses ESPN's unofficial public API to fetch live PGA Tour leaderboard data.
 * This endpoint is widely used and stable but is unofficial — handle errors
 * gracefully and treat the data as best-effort.
 *
 * Server-only: this file must not be imported by client components.
 */

import type { Tournament, Golfer } from "@/lib/types";
import { getActionNetworkPgaOdds } from "@/lib/actionnetwork";

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
  linescores?: EspnLinescore[]; // per-hole data when nested inside a round linescore
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
  /** True when ESPN's competition status is STATUS_FINAL — authoritative tournament-complete signal. */
  tournamentComplete: boolean;
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
// Core API cut status (authoritative source — site API never sets STATUS_CUT
// in scoreboard competitor data during live rounds)
// ---------------------------------------------------------------------------

async function fetchCoreApiCutStatuses(
  eventId: string,
  competitionId: string,
  competitors: EspnCompetitor[],
  effectivePeriod: number,
): Promise<Map<string, string>> {
  if (effectivePeriod < 3) return new Map();

  // Only need to check players without current-round data — players who started
  // the round are definitively active; cut/WD players won't have round data.
  const toCheck = competitors.filter((c) => {
    const ls = c.linescores?.[effectivePeriod - 1];
    const val = typeof ls?.value === "string" ? parseFloat(ls.value) : (ls?.value ?? 0);
    const holes = ls?.linescores?.length ?? 0;
    return !((typeof val === "number" && !isNaN(val) && val > 0) || holes > 0);
  });

  if (toCheck.length === 0) return new Map();

  const map = new Map<string, string>();
  const BATCH = 50; // parallel at a time to avoid overwhelming ESPN

  for (let i = 0; i < toCheck.length; i += BATCH) {
    const batch = toCheck.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (c): Promise<{ id: string; statusName: string }> => {
        try {
          const url = `https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/events/${eventId}/competitions/${competitionId}/competitors/${c.id}/status`;
          const res = await fetch(url, {
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) return { id: c.id, statusName: "" };
          const data = (await res.json()) as { type?: { name?: string } };
          return { id: c.id, statusName: data?.type?.name ?? "" };
        } catch {
          return { id: c.id, statusName: "" };
        }
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") map.set(r.value.id, r.value.statusName);
    }
  }

  return map;
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
  coreStatusMap: Map<string, string> = new Map(),
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

  // Pre-scan: find the WORST (max) R1+R2 stroke total among players who have
  // actively started the current round (have per-hole linescore data or a positive
  // round total). Those players definitively made the cut. Any player with NO
  // current-round data and R1+R2 total STRICTLY GREATER THAN this limit missed
  // the cut — even if ESPN hasn't set STATUS_CUT for them yet.
  // Safe at round start: limit stays null until any player tees off.
  let madeCutStrokeLimit: number | null = null;
  if (effectivePeriod >= 3) {
    const r3Totals: number[] = [];
    for (const c of competitors) {
      const ls2 = c.linescores?.[effectivePeriod - 1];
      const r3val = typeof ls2?.value === "string" ? parseFloat(ls2.value) : (ls2?.value ?? NaN);
      const holesInCurrentRound = ls2?.linescores?.length ?? 0;
      const inCurrentRound = (!isNaN(r3val as number) && (r3val as number) > 0) || holesInCurrentRound > 0;
      if (!inCurrentRound) continue;
      const ls0 = c.linescores?.[0];
      const ls1 = c.linescores?.[1];
      const v0 = typeof ls0?.value === "string" ? parseFloat(ls0.value) : (ls0?.value ?? NaN);
      const v1 = typeof ls1?.value === "string" ? parseFloat(ls1.value) : (ls1?.value ?? NaN);
      if (typeof v0 === "number" && !isNaN(v0) && v0 > 0 && typeof v1 === "number" && !isNaN(v1) && v1 > 0) {
        r3Totals.push(v0 + v1);
      }
    }
    if (r3Totals.length > 0) madeCutStrokeLimit = Math.max(...r3Totals);
  }

  const rawGolfers: GolferScoreUpdate[] = competitors.map((c) => {
    const statusName = c.status?.type?.name ?? "";
    const scoreValue = c.score ?? "";
    const scoreTrimmed = scoreValue.trim().toUpperCase();

    // --- Cut detection ---
    // Primary: core API status (authoritative — site API never sets STATUS_CUT
    // in scoreboard data during live rounds)
    const coreStatus = coreStatusMap.get(c.id) ?? "";
    const explicitCutLike =
      CUT_STATUSES.has(statusName) ||
      CUT_STATUSES.has(coreStatus) ||
      scoreTrimmed === "CUT" ||
      scoreTrimmed === "WD" ||
      scoreTrimmed === "DQ" ||
      scoreTrimmed === "MDF";

    // Infer cut: if R1+R2 strokes > madeCutStrokeLimit (worst made-cut total)
    // and this player has no current-round data, they missed the cut.
    const validLsCount = (c.linescores ?? []).filter((ls) => {
      const v = typeof ls.value === "string" ? parseFloat(ls.value) : ls.value;
      return typeof v === "number" && !isNaN(v) && v > 0;
    }).length;
    let playerStrokesThru2: number | null = null;
    {
      const ls0 = c.linescores?.[0];
      const ls1 = c.linescores?.[1];
      const v0 = typeof ls0?.value === "string" ? parseFloat(ls0.value) : (ls0?.value ?? NaN);
      const v1 = typeof ls1?.value === "string" ? parseFloat(ls1.value) : (ls1?.value ?? NaN);
      if (typeof v0 === "number" && !isNaN(v0) && v0 > 0 && typeof v1 === "number" && !isNaN(v1) && v1 > 0) {
        playerStrokesThru2 = v0 + v1;
      }
    }
    const inferredCut =
      !explicitCutLike &&
      effectivePeriod >= 3 &&
      validLsCount < effectivePeriod &&
      madeCutStrokeLimit !== null &&
      playerStrokesThru2 !== null &&
      playerStrokesThru2 > madeCutStrokeLimit;

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
      const effectiveStatus = statusName || coreStatus;
      if (effectiveStatus) {
        position = positionFromStatus(effectiveStatus);
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

  // Compute effectivePeriod here so we can decide whether to hit the core API.
  // Mirrors the same derivation inside parseCompetitors.
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

  // Fetch explicit cut statuses from ESPN's core API — the site API scoreboard
  // never sets STATUS_CUT on competitor data during live rounds, so we must
  // query per-competitor status endpoints for authoritative cut detection.
  const competitionId = competition?.id ?? event.id;
  const coreStatusMap = await fetchCoreApiCutStatuses(event.id, competitionId, competitors, effectivePeriod);

  const golfers = parseCompetitors(competitors, competitionPeriod, coreStatusMap);

  const tournamentComplete =
    competition?.status?.type?.name === "STATUS_FINAL";

  return {
    eventId: event.id,
    eventName: event.name,
    golfers,
    fetchedAt: new Date().toISOString(),
    tournamentComplete,
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

// ---------------------------------------------------------------------------
// Tournament import (replaces DraftKings as the source for pool creation)
// ---------------------------------------------------------------------------

export type EspnUpcomingTournament = {
  id: string;
  leagueId: string;
  slug: string;
  name: string;
  startDate: string | null;
  url: string;
  oddsUrl: string;
};

export type EspnTournamentFeed = {
  tournament: Tournament;
  golfers: Golfer[];
  oddsSourceUrl: string;
};

/** Returns all non-finished PGA Tour events from the ESPN scoreboard. */
export async function getUpcomingEspnTournaments(): Promise<EspnUpcomingTournament[]> {
  const res = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard",
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`ESPN scoreboard fetch failed: ${res.status}`);
  const data = (await res.json()) as EspnScoreboard;

  return (data.events ?? [])
    .filter((e) => e.competitions?.[0]?.status?.type?.name !== "STATUS_FINAL")
    .map((e) => ({
      id: e.id,
      leagueId: e.id,
      slug: e.id,
      name: e.name,
      startDate: e.date ?? null,
      url: `https://www.espn.com/golf/leaderboard?tournamentId=${e.id}`,
      oddsUrl: `https://www.espn.com/golf/leaderboard?tournamentId=${e.id}`,
    }));
}

/**
 * Fetch the full competitor field for an ESPN event and return it in the
 * same shape that DraftKings previously provided to the create-pool wizard.
 * Golfers are ordered by ESPN's leaderboard order field so that tier 1
 * starts with the favourites.
 */
export async function importEspnTournament(eventId: string): Promise<EspnTournamentFeed> {
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?event=${eventId}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`ESPN event fetch failed: ${res.status}`);
  const data = (await res.json()) as EspnScoreboard;

  const event = data.events?.[0];
  if (!event) throw new Error("ESPN event not found.");

  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  if (competitors.length === 0) {
    throw new Error("The field for this tournament has not been announced yet on ESPN.");
  }

  const tournamentId = `espn-${eventId}`;

  // Enrich with tournament winner odds from Action Network.
  // AN odds are embedded in their SSR page — no API key needed.
  // Fail silently and fall back to ESPN's field order if unavailable.
  let anOddsMap = new Map<string, number>();
  try {
    const { oddsMap } = await getActionNetworkPgaOdds();
    anOddsMap = oddsMap;
  } catch {
    // Fall back to ESPN order
  }

  const golfers: Golfer[] = competitors
    .map((c) => {
      const normalizedName = normalizeGolferName(c.athlete.displayName);
      const americanOdds = anOddsMap.get(normalizedName) ?? 0;

      // Derive implied probability from American odds only.
      // Do NOT fall back to ESPN's field order — it reflects registration
      // or alphabetical sequence, not win likelihood, and would incorrectly
      // promote obscure players into upper tiers when AN odds are missing.
      const impliedProbability =
        americanOdds > 0 ? 100 / (americanOdds + 100) : 0;

      return {
        id: `${tournamentId}-${c.id}`,
        name: c.athlete.displayName,
        oddsAmerican: americanOdds,
        impliedProbability,
        tournamentId,
        currentScoreToPar: 0,
        position: "TBD",
        madeCut: true,
        roundsComplete: 0,
      };
    })
    .sort((a, b) => b.impliedProbability - a.impliedProbability);

  const statusName = competition?.status?.type?.name;
  const tournamentStatus: Tournament["status"] =
    statusName === "STATUS_FINAL"
      ? "finished"
      : statusName === "STATUS_IN_PROGRESS"
        ? "in_progress"
        : "upcoming";

  const oddsSourceUrl = `https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?event=${eventId}`;

  const tournament: Tournament = {
    id: tournamentId,
    name: event.name,
    course: "TBD",
    startDate: event.date ?? new Date().toISOString(),
    status: tournamentStatus,
    purse: "TBD",
    source: "espn",
    sourceUrl: `https://www.espn.com/golf/leaderboard?tournamentId=${eventId}`,
    oddsSourceUrl,
    importMeta: {
      leagueId: null,
      eventId,
      categoryId: null,
      subcategoryId: null,
    },
  };

  return { tournament, golfers, oddsSourceUrl };
}
