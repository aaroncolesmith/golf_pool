import { NextResponse } from "next/server";
import { fetchEspnScores, fetchEspnScoresByDate, fetchEspnScoresByEventId, normalizeGolferName } from "@/lib/espn";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST /api/scores/sync
 *
 * Body: { tournamentId: string; date?: string; espnEventId?: string }
 *
 * Fetches scores from ESPN for the given tournament and writes them to Supabase.
 *
 * When neither date nor espnEventId are provided (auto mode), the server tries:
 *   1. Previously stored espn_event_id on the tournament row
 *   2. Current ESPN scoreboard (works while tournament is live)
 *   3. Dated scoreboard for computed final-round dates (start_date +3, +2, +4, +1)
 *
 * When espnEventId is provided, it is saved to the tournament row immediately so
 * future auto-syncs use it without any manual input.
 */
export async function POST(request: Request) {
  let body: { tournamentId?: string; date?: string; espnEventId?: string };
  try {
    body = (await request.json()) as { tournamentId?: string; date?: string; espnEventId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const { tournamentId, date, espnEventId } = body;
  if (!tournamentId || typeof tournamentId !== "string") {
    return NextResponse.json({ ok: false, error: "tournamentId is required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }

  // Use select("*") to avoid errors if optional columns (espn_event_id) don't exist yet.
  const { data: tournament, error: tError } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", tournamentId)
    .single();

  if (tError) {
    console.error("[sync] Tournament query error:", tError.message);
    return NextResponse.json(
      { ok: false, error: `Failed to load tournament: ${tError.message}` },
      { status: 500 },
    );
  }
  if (!tournament) {
    return NextResponse.json({ ok: false, error: "Tournament not found." }, { status: 404 });
  }

  const tName = tournament.name as string;
  const startDateStr = (tournament.start_date as string | null) ?? null;
  const storedEventId = (tournament.espn_event_id as string | null) ?? null;

  // If the caller supplied an ESPN event ID, save it to the tournament row immediately
  // so future auto-syncs can use it without any manual input.
  if (espnEventId && espnEventId !== storedEventId) {
    await supabase
      .from("tournaments")
      .update({ espn_event_id: espnEventId })
      .eq("id", tournamentId);
  }

  // Build a prioritized strategy list — try each in order until one works.
  type Strategy = () => Promise<Awaited<ReturnType<typeof fetchEspnScores>>>;
  const strategies: Strategy[] = [];

  if (espnEventId) {
    strategies.push(() => fetchEspnScoresByEventId(espnEventId, tName));
  } else if (date) {
    strategies.push(() => fetchEspnScoresByDate(tName, date));
  } else {
    // Auto mode
    const effectiveEventId = espnEventId ?? storedEventId;
    if (effectiveEventId) {
      strategies.push(() => fetchEspnScoresByEventId(effectiveEventId, tName));
    }
    // Current scoreboard (live/upcoming)
    strategies.push(() => fetchEspnScores(tName));
    // Dated scoreboard: PGA Tour runs Thu–Sun so final round ≈ start + 3 days.
    if (startDateStr) {
      const startDate = new Date(startDateStr);
      for (const offset of [3, 2, 4, 1, 0]) {
        const candidate = new Date(startDate);
        candidate.setUTCDate(candidate.getUTCDate() + offset);
        const yyyymmdd = candidate.toISOString().slice(0, 10).replace(/-/g, "");
        strategies.push(() => fetchEspnScoresByDate(tName, yyyymmdd));
      }
    }
  }

  let espnResult: Awaited<ReturnType<typeof fetchEspnScores>> = null;
  for (const strategy of strategies) {
    espnResult = await strategy();
    if (espnResult) break;
  }

  if (!espnResult) {
    const hint = startDateStr
      ? ` Try "Advanced sync options" and enter the specific date or ESPN event ID.`
      : "";
    return NextResponse.json(
      {
        ok: false,
        error: espnEventId
          ? `ESPN returned no data for event ID "${espnEventId}". Verify the ID is correct.`
          : date
            ? `No ESPN data found for ${date}. Try a different date.`
            : `Could not find this tournament on ESPN.${hint}`,
      },
      { status: 502 },
    );
  }

  // Load our golfers
  const { data: ourGolfers, error: gError } = await supabase
    .from("golfers")
    .select("id, name, tournament_id, odds_american, implied_probability")
    .eq("tournament_id", tournamentId);

  if (gError || !ourGolfers) {
    return NextResponse.json({ ok: false, error: "Failed to load golfer list." }, { status: 500 });
  }

  type OurGolfer = {
    id: string; name: string; tournament_id: string;
    odds_american: number; implied_probability: number;
  };

  const golferByNorm = new Map<string, OurGolfer>();
  for (const g of ourGolfers as OurGolfer[]) {
    golferByNorm.set(normalizeGolferName(g.name), g);
  }

  const updates: Array<{
    id: string; tournament_id: string; name: string;
    odds_american: number; implied_probability: number;
    current_score_to_par: number; position: string;
    made_cut: boolean; rounds_complete: number;
    r1_score: number | null; r2_score: number | null;
    r3_score: number | null; r4_score: number | null;
  }> = [];
  const unmatched: string[] = [];

  for (const espnGolfer of espnResult.golfers) {
    const normalized = normalizeGolferName(espnGolfer.displayName);
    let ourGolfer = golferByNorm.get(normalized);
    if (!ourGolfer) {
      const lastName = normalized.split(" ").at(-1) ?? "";
      for (const [key, g] of golferByNorm) {
        if (key.endsWith(` ${lastName}`) || key === lastName) { ourGolfer = g; break; }
      }
    }
    if (!ourGolfer) { unmatched.push(espnGolfer.displayName); continue; }
    updates.push({
      id: ourGolfer.id,
      tournament_id: ourGolfer.tournament_id,
      name: ourGolfer.name,
      odds_american: ourGolfer.odds_american,
      implied_probability: ourGolfer.implied_probability,
      current_score_to_par: espnGolfer.scoreToParInt,
      position: espnGolfer.position,
      made_cut: espnGolfer.madeCut,
      rounds_complete: espnGolfer.roundsComplete,
      r1_score: espnGolfer.r1Score,
      r2_score: espnGolfer.r2Score,
      r3_score: espnGolfer.r3Score,
      r4_score: espnGolfer.r4Score,
    });
  }

  const dedupedUpdates = Array.from(new Map(updates.map((u) => [u.id, u])).values());

  if (dedupedUpdates.length > 0) {
    const { error: upsertError } = await supabase
      .from("golfers")
      .upsert(dedupedUpdates, { onConflict: "id" });
    if (upsertError) {
      console.error("[sync] Upsert error:", upsertError);
      return NextResponse.json(
        { ok: false, error: `Failed to write scores: ${upsertError.message}` },
        { status: 500 },
      );
    }
  }

  // Auto-detect finished: if every player who made the cut has 4 complete rounds,
  // the tournament is done. Otherwise keep/set it as in_progress.
  const allActiveFinished = espnResult.golfers.every((g) => !g.madeCut || g.roundsComplete >= 4);
  const newStatus = allActiveFinished ? "finished" : "in_progress";

  await supabase
    .from("tournaments")
    .update({ scores_updated_at: espnResult.fetchedAt, espn_event_id: espnResult.eventId, status: newStatus })
    .eq("id", tournamentId);

  return NextResponse.json({
    ok: true,
    eventName: espnResult.eventName,
    updated: dedupedUpdates.length,
    unmatched,
    fetchedAt: espnResult.fetchedAt,
  });
}
