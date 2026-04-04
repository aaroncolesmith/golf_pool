import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeGolferName } from "@/lib/espn";

/**
 * GET /api/scores/tournament?tournamentId=xxx
 *
 * Returns full tournament leaderboard data from ESPN, including per-round
 * stroke counts, today's score, position, and cut status.
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
  period?: { number: number };
  value: number | string;
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
  const stopWords = new Set(["the", "pga", "tour", "championship", "open", "of", "at", "in"]);
  return normalized
    .split(" ")
    .filter((w) => w.length > 2 && !stopWords.has(w));
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

  if (bestEvent && bestScore > 0) return bestEvent;
  return events[0] ?? null;
}

function parseRoundScore(value: number | string | undefined): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === "string" ? parseFloat(value) : value;
  return isFinite(n) && !isNaN(n) ? n : null;
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

  // Load tournament name from Supabase
  const supabase = await createSupabaseServerClient();
  const { data: tournament, error: tError } = await supabase
    .from("tournaments")
    .select("id, name")
    .eq("id", tournamentId)
    .single();

  if (tError || !tournament) {
    return NextResponse.json({ ok: false, error: "Tournament not found." }, { status: 404 });
  }

  // Fetch ESPN scoreboard
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
      return NextResponse.json(
        { ok: false, error: `ESPN fetch failed: ${res.status} ${res.statusText}` },
        { status: 502 },
      );
    }

    espnData = (await res.json()) as EspnScoreboard;
  } catch (err) {
    console.error("[tournament] ESPN fetch error:", err);
    return NextResponse.json({ ok: false, error: "Failed to fetch ESPN data." }, { status: 502 });
  }

  const events = espnData.events ?? [];
  const event = findBestEvent(events, tournament.name as string);

  if (!event) {
    return NextResponse.json(
      { ok: false, error: "No matching event found on ESPN for this tournament." },
      { status: 404 },
    );
  }

  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const competitionStatus = competition?.status;

  // Build golfer list
  const rawGolfers = competitors.map((c): TournamentGolfer & { _scoreToParInt: number } => {
    const statusName = c.status?.type?.name ?? "";
    const scoreValue = c.score ?? "";
    const scoreTrimmed = scoreValue.trim().toUpperCase();

    const isCutLike =
      CUT_STATUSES.has(statusName) ||
      scoreTrimmed === "CUT" ||
      scoreTrimmed === "WD" ||
      scoreTrimmed === "DQ" ||
      scoreTrimmed === "MDF";

    const madeCut = !isCutLike;

    // Per-round stroke counts, indexed by period number (1-based)
    const roundScores: Record<number, number | null> = {};
    if (c.linescores) {
      for (const ls of c.linescores) {
        const period = ls.period?.number;
        if (period !== undefined) {
          roundScores[period] = parseRoundScore(ls.value);
        } else {
          // Linescores without period: assign sequentially
          const nextIdx = Object.keys(roundScores).length + 1;
          roundScores[nextIdx] = parseRoundScore(ls.value);
        }
      }
    }

    // Today: last valid round value
    let today: number | null = null;
    if (c.linescores && c.linescores.length > 0) {
      for (let i = c.linescores.length - 1; i >= 0; i--) {
        const v = parseRoundScore(c.linescores[i].value);
        if (v !== null) {
          today = v;
          break;
        }
      }
    }

    // Thru: use competitor status detail, then competition status detail, then fallback
    let thru = "-";
    const competitorDetail = c.status?.type?.detail;
    const competitionDetail = competitionStatus?.type?.detail;
    if (competitorDetail) {
      thru = competitorDetail;
    } else if (competitionDetail) {
      thru = competitionDetail;
    }

    // Position for cut players
    let position: string;
    if (!madeCut) {
      if (statusName === "STATUS_WD" || scoreTrimmed === "WD") position = "WD";
      else if (statusName === "STATUS_DQ" || scoreTrimmed === "DQ") position = "DQ";
      else position = "CUT";
    } else {
      position = c.order !== undefined ? String(c.order) : "TBD";
    }

    const scoreToParInt = isCutLike ? 0 : parseScoreToPar(scoreValue);

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

  // Derive tie positions for active players from sorted scores
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

  return NextResponse.json({ ok: true, golfers });
}
