import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeGolferName } from "@/lib/espn";

/**
 * GET /api/scores/tournament?tournamentId=xxx
 *
 * Returns full tournament leaderboard data including per-round stroke counts,
 * today's score, position, and cut status.
 *
 * For finished tournaments the response is served entirely from the database so
 * the data is stable and consistent regardless of what ESPN's current scoreboard
 * shows. For in-progress tournaments ESPN is tried first; the DB is the fallback
 * if ESPN cannot find the event.
 *
 * No authentication required — this is public data.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TournamentGolfer = {
  name: string;
  position: string;
  score: number;
  today: number | null;
  thru: string;
  r1: number | null;
  r2: number | null;
  r3: number | null;
  r4: number | null;
  madeCut: boolean;
};

// ---------------------------------------------------------------------------
// Raw ESPN types (local — mirrors lib/espn.ts shapes)
// ---------------------------------------------------------------------------

type EspnStatusType = {
  id: string;
  name: string;
  description: string;
  detail?: string;
};

type EspnLinescore = {
  period?: number; // round number (1-based) — direct number in current ESPN API
  value?: number | string;
  displayValue?: string;
  linescores?: EspnLinescore[]; // per-hole scores nested inside each round's linescore
};

type EspnCompetitor = {
  id: string;
  athlete: { id: string; displayName: string };
  score?: string;
  status?: { type: EspnStatusType; period?: number };
  linescores?: EspnLinescore[];
  order?: number;
};

type EspnCompetitionStatus = {
  period?: number;
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
// Helpers
// ---------------------------------------------------------------------------

const CUT_STATUSES = new Set(["STATUS_CUT", "STATUS_WD", "STATUS_DQ", "STATUS_MDF"]);

function parseScoreToPar(raw: string | undefined): number {
  if (!raw) return 0;
  const trimmed = raw.trim().toUpperCase();
  if (trimmed === "E" || trimmed === "EVEN" || trimmed === "") return 0;
  const n = parseInt(trimmed, 10);
  return isNaN(n) ? 0 : n;
}

function scoreKeywords(name: string): string[] {
  const normalized = normalizeGolferName(name);
  const stopWords = new Set(["the", "tour", "of", "at", "in", "presented", "by", "hosted"]);
  const filtered = normalized.split(" ").filter((w) => w.length > 2 && !stopWords.has(w));
  return filtered.length > 0 ? filtered : normalized.split(" ").filter((w) => w.length > 2);
}

function findBestEvent(events: EspnEvent[], tournamentName: string): EspnEvent | null {
  if (!events.length) return null;

  const target = normalizeGolferName(tournamentName);
  const keywords = scoreKeywords(tournamentName);

  const exact = events.find((e) => normalizeGolferName(e.name) === target);
  if (exact) return exact;

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

  // Require at least one keyword to match — never silently serve the wrong event.
  if (bestEvent && bestScore > 0) return bestEvent;
  return null;
}

function parseRoundScore(value: number | string | undefined): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === "string" ? parseFloat(value) : value;
  return isFinite(n) && !isNaN(n) ? n : null;
}

// ---------------------------------------------------------------------------
// DB fallback: build TournamentGolfer[] from the golfers table
// ---------------------------------------------------------------------------

type DbGolfer = {
  name: string;
  current_score_to_par: number;
  position: string;
  made_cut: boolean;
  rounds_complete: number;
  r1_score: number | null;
  r2_score: number | null;
  r3_score: number | null;
  r4_score: number | null;
};

function buildFromDb(dbGolfers: DbGolfer[]): TournamentGolfer[] {
  // Recompute positions from stored scores so ties are labelled correctly.
  const active = dbGolfers
    .filter((g) => g.made_cut)
    .sort((a, b) => a.current_score_to_par - b.current_score_to_par);

  const scoreToPos = new Map<number, string>();
  let i = 0;
  while (i < active.length) {
    const score = active[i].current_score_to_par;
    const tied = active.filter((g) => g.current_score_to_par === score);
    const pos = tied.length > 1 ? `T${i + 1}` : `${i + 1}`;
    scoreToPos.set(score, pos);
    i += tied.length;
  }

  return dbGolfers.map((g): TournamentGolfer => {
    let position: string;
    if (!g.made_cut) {
      position = g.position; // CUT / WD / DQ as stored
    } else {
      position = scoreToPos.get(g.current_score_to_par) ?? g.position;
    }

    // thru: "F" when all rounds are complete and the player made the cut
    let thru = "-";
    if (g.made_cut) {
      thru = g.rounds_complete >= 4 ? "F" : `R${g.rounds_complete}`;
    }

    return {
      name: g.name,
      position,
      score: g.current_score_to_par,
      today: null, // not derivable from DB without par
      thru,
      r1: g.r1_score,
      r2: g.r2_score,
      r3: g.r3_score,
      r4: g.r4_score,
      madeCut: g.made_cut,
    };
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tournamentId = searchParams.get("tournamentId");

  if (!tournamentId) {
    return NextResponse.json({ ok: false, error: "tournamentId is required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  // Load tournament — status determines whether we go to ESPN or straight to DB
  const { data: tournament, error: tError } = await supabase
    .from("tournaments")
    .select("id, name, status")
    .eq("id", tournamentId)
    .single();

  if (tError || !tournament) {
    return NextResponse.json({ ok: false, error: "Tournament not found." }, { status: 404 });
  }

  const isFinished = tournament.status === "finished";

  // Helper: fetch from DB and return
  async function returnFromDb(): Promise<NextResponse> {
    const { data: dbGolfers, error: gErr } = await supabase
      .from("golfers")
      .select("name, current_score_to_par, position, made_cut, rounds_complete, r1_score, r2_score, r3_score, r4_score")
      .eq("tournament_id", tournamentId!)
      .order("current_score_to_par", { ascending: true });

    if (gErr || !dbGolfers || dbGolfers.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Tournament leaderboard not yet available. Check back once the tournament begins." },
        { status: 404 },
      );
    }

    const golfers = buildFromDb(dbGolfers as DbGolfer[]);
    return NextResponse.json({ ok: true, golfers, source: "db" });
  }

  // For finished tournaments always use the DB — ESPN's scoreboard no longer
  // has the event and the DB holds the authoritative final scores.
  if (isFinished) {
    return returnFromDb();
  }

  // For live/upcoming tournaments, try ESPN first
  let espnData: EspnScoreboard;
  try {
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; GolfPoolApp/1.0)",
        },
      },
    );

    if (!res.ok) {
      console.warn(`[tournament] ESPN fetch failed: ${res.status} — falling back to DB`);
      return returnFromDb();
    }

    espnData = (await res.json()) as EspnScoreboard;
  } catch (err) {
    console.error("[tournament] ESPN fetch error:", err);
    return returnFromDb();
  }

  const events = espnData.events ?? [];
  const event = findBestEvent(events, tournament.name as string);

  // If ESPN doesn't have this tournament, fall back to DB
  if (!event) {
    console.warn(`[tournament] Event not found on ESPN scoreboard — falling back to DB for "${tournament.name}"`);
    return returnFromDb();
  }

  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const competitionStatus = competition?.status;
  const currentPeriod = competitionStatus?.period ?? 1;

  // Derive course par per round dynamically to avoid the par-70/72 assumption
  let coursePar = 72;
  if (currentPeriod >= 2) {
    const parSamples: number[] = [];
    for (const c of competitors) {
      const statusName = c.status?.type?.name ?? "";
      const scoreTrimmed = (c.score ?? "").trim().toUpperCase();
      if (CUT_STATUSES.has(statusName) || ["CUT", "WD", "DQ", "MDF"].includes(scoreTrimmed)) continue;
      if (!c.linescores) continue;
      const currentRoundLS = c.linescores[currentPeriod - 1];
      const holesStarted = currentRoundLS?.linescores?.length ?? 0;
      const currentRoundVal = parseRoundScore(currentRoundLS?.value);
      if (holesStarted > 0 || (currentRoundVal && currentRoundVal > 0)) continue;
      let totalStrokes = 0;
      let valid = true;
      const rounds = currentPeriod - 1;
      for (let r = 0; r < rounds; r++) {
        const val = parseRoundScore(c.linescores[r]?.value);
        if (!val || val <= 0) { valid = false; break; }
        totalStrokes += val;
      }
      if (!valid || rounds === 0) continue;
      const implied = (totalStrokes - parseScoreToPar(c.score ?? "")) / rounds;
      if (Number.isInteger(implied) && implied >= 68 && implied <= 74) parSamples.push(implied);
    }
    if (parSamples.length >= 2) {
      const freq = new Map<number, number>();
      for (const p of parSamples) freq.set(p, (freq.get(p) ?? 0) + 1);
      coursePar = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  // Build golfer list
  const rawGolfers = competitors.map((c): TournamentGolfer & { _scoreToParInt: number } => {
    const statusName = c.status?.type?.name ?? "";
    const scoreValue = c.score ?? "";
    const scoreTrimmed = scoreValue.trim().toUpperCase();

    const explicitCutLike =
      CUT_STATUSES.has(statusName) ||
      scoreTrimmed === "CUT" ||
      scoreTrimmed === "WD" ||
      scoreTrimmed === "DQ" ||
      scoreTrimmed === "MDF";

    const lsCount = c.linescores?.length ?? 0;
    const inferredCut = !explicitCutLike && currentPeriod >= 3 && lsCount < 3;

    const isCutLike = explicitCutLike || inferredCut;
    const madeCut = !isCutLike;
    const scoreToParInt = parseScoreToPar(scoreValue);

    const roundScores: Record<number, number | null> = {};
    if (c.linescores) {
      c.linescores.forEach((ls, idx) => {
        const roundNum = idx + 1;
        const val = parseRoundScore(ls.value);
        if (val === null || val <= 0) return;
        if (roundNum < currentPeriod) {
          roundScores[roundNum] = val;
        } else if (roundNum === currentPeriod) {
          const holesPlayed = ls.linescores?.length ?? 0;
          if (holesPlayed >= 18) roundScores[roundNum] = val;
        }
      });
    }

    let thru = "-";
    if (madeCut) {
      const currentRoundLS = c.linescores?.[currentPeriod - 1];
      const holesCompleted = currentRoundLS?.linescores?.length ?? 0;
      if (holesCompleted >= 18) {
        thru = "F";
      } else if (holesCompleted > 0) {
        thru = String(holesCompleted);
      }
    }

    let today: number | null = null;
    if (madeCut && thru !== "-") {
      let completedTopar = 0;
      for (let p = 1; p < currentPeriod; p++) {
        const raw = roundScores[p];
        if (raw !== null && raw !== undefined) {
          completedTopar += raw - coursePar;
        }
      }
      today = scoreToParInt - completedTopar;
    }

    let position: string;
    if (!madeCut) {
      if (statusName === "STATUS_WD" || scoreTrimmed === "WD") position = "WD";
      else if (statusName === "STATUS_DQ" || scoreTrimmed === "DQ") position = "DQ";
      else position = "CUT";
    } else {
      position = c.order !== undefined ? String(c.order) : "TBD";
    }

    return {
      name: c.athlete.displayName,
      position,
      score: scoreToParInt,
      today,
      thru,
      r1: roundScores[1] ?? null,
      r2: roundScores[2] ?? null,
      r3: roundScores[3] ?? null,
      r4: roundScores[4] ?? null,
      madeCut,
      _scoreToParInt: scoreToParInt,
    };
  });

  // Derive tie positions for active players
  const active = rawGolfers.filter((g) => g.madeCut).sort((a, b) => a._scoreToParInt - b._scoreToParInt);
  const scoreToPosition = new Map<number, string>();
  let i = 0;
  while (i < active.length) {
    const score = active[i]._scoreToParInt;
    const tied = active.filter((g) => g._scoreToParInt === score);
    const pos = tied.length > 1 ? `T${i + 1}` : `${i + 1}`;
    scoreToPosition.set(score, pos);
    i += tied.length;
  }

  const golfers: TournamentGolfer[] = rawGolfers.map(({ _scoreToParInt, ...g }) => {
    if (g.madeCut) {
      return { ...g, position: scoreToPosition.get(_scoreToParInt) ?? g.position };
    }
    return g;
  });

  return NextResponse.json({ ok: true, golfers, source: "espn" });
}
