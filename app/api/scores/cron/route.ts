import { NextResponse } from "next/server";
import {
  fetchEspnScores,
  fetchEspnScoresByDate,
  fetchEspnScoresByEventId,
  normalizeGolferName,
} from "@/lib/espn";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/scores/cron
 *
 * Called by GitHub Actions on a schedule during and after tournament rounds.
 * Syncs ESPN scores for every tournament currently marked `in_progress`.
 *
 * Uses the same multi-strategy fetch as the manual sync route so that
 * recently-finished tournaments (which drop off ESPN's current scoreboard)
 * are still found via their stored espn_event_id or a dated scoreboard URL.
 *
 * Protected by CRON_SECRET env var — caller must pass:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Uses the Supabase service-role key so it can write without a user session.
 *
 * Response:
 *   { ok: true, results: [{ tournamentId, eventName, updated, unmatched }] }
 *   { ok: false, error: string }
 */
export async function GET(request: Request) {
  // Auth check
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET env var is not set.");
    return NextResponse.json({ ok: false, error: "Server misconfiguration." }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  // Use service-role client — no user session needed
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Find all in-progress tournaments, including espn_event_id + start_date for fallback fetching
  const { data: tournaments, error: tError } = await supabase
    .from("tournaments")
    .select("id, name, espn_event_id, start_date, status")
    .in("status", ["upcoming", "in_progress"]);

  if (tError) {
    console.error("[cron] Failed to load tournaments:", tError);
    return NextResponse.json({ ok: false, error: "Failed to load tournaments." }, { status: 500 });
  }

  if (!tournaments || tournaments.length === 0) {
    return NextResponse.json({ ok: true, results: [], message: "No active tournaments." });
  }

  const results = [];

  for (const tournament of tournaments) {
    try {
      const tName = tournament.name as string;
      const eventId = (tournament.espn_event_id as string | null) ?? null;
      const startDate = (tournament.start_date as string | null) ?? null;

      // Build a prioritized fetch strategy — mirrors the manual sync route.
      // Try espn_event_id first (most reliable: works even after a tournament
      // leaves the live scoreboard). Fall back to current scoreboard name-match,
      // then dated scoreboards for the expected final-round dates.
      type Strategy = () => Promise<Awaited<ReturnType<typeof fetchEspnScores>>>;
      const strategies: Strategy[] = [];

      if (eventId) {
        strategies.push(() => fetchEspnScoresByEventId(eventId, tName));
      }
      strategies.push(() => fetchEspnScores(tName));

      if (startDate) {
        const base = new Date(startDate);
        for (const offset of [3, 2, 4, 1, 0]) {
          const d = new Date(base);
          d.setUTCDate(d.getUTCDate() + offset);
          const yyyymmdd = d.toISOString().slice(0, 10).replace(/-/g, "");
          strategies.push(() => fetchEspnScoresByDate(tName, yyyymmdd));
        }
      }

      let espnResult: Awaited<ReturnType<typeof fetchEspnScores>> = null;
      for (const strategy of strategies) {
        espnResult = await strategy();
        if (espnResult) break;
      }

      if (!espnResult) {
        console.warn(`[cron] ESPN returned no data for tournament: ${tName}`);
        results.push({ tournamentId: tournament.id, ok: false, error: "No ESPN data" });
        continue;
      }

      // Load our golfers — include all NOT NULL columns so the upsert payload is
      // complete (PostgREST evaluates NOT NULL constraints on the INSERT branch
      // of ON CONFLICT before detecting the key conflict on some versions).
      const { data: ourGolfers, error: gError } = await supabase
        .from("golfers")
        .select("id, name, tournament_id, odds_american, implied_probability")
        .eq("tournament_id", tournament.id);

      if (gError || !ourGolfers) {
        console.error(`[cron] Failed to load golfers for ${tournament.id}:`, gError);
        results.push({ tournamentId: tournament.id, ok: false, error: "Failed to load golfers" });
        continue;
      }

      type OurGolfer = {
        id: string;
        name: string;
        tournament_id: string;
        odds_american: number;
        implied_probability: number;
      };

      // Build normalized-name → golfer map
      const golferMap = new Map<string, OurGolfer>();
      for (const g of ourGolfers as OurGolfer[]) {
        golferMap.set(normalizeGolferName(g.name), g);
      }

      // Match ESPN golfers to our golfers
      const updates: Array<{
        id: string;
        tournament_id: string;
        name: string;
        odds_american: number;
        implied_probability: number;
        current_score_to_par: number;
        position: string;
        made_cut: boolean;
        rounds_complete: number;
        r1_score: number | null;
        r2_score: number | null;
        r3_score: number | null;
        r4_score: number | null;
      }> = [];
      const unmatched: string[] = [];

      for (const espnGolfer of espnResult.golfers) {
        const normalized = normalizeGolferName(espnGolfer.displayName);
        let ourGolfer = golferMap.get(normalized);

        // Fallback: last name only
        if (!ourGolfer) {
          const lastName = normalized.split(" ").at(-1) ?? "";
          for (const [key, g] of golferMap) {
            if (key.endsWith(` ${lastName}`) || key === lastName) {
              ourGolfer = g;
              break;
            }
          }
        }

        if (!ourGolfer) {
          unmatched.push(espnGolfer.displayName);
          continue;
        }

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

      if (updates.length > 0) {
        const { error: upsertError } = await supabase
          .from("golfers")
          .upsert(updates, { onConflict: "id" });

        if (upsertError) {
          console.error(`[cron] Upsert error for ${tournament.id}:`, upsertError);
          results.push({ tournamentId: tournament.id, ok: false, error: "Upsert failed" });
          continue;
        }
      }

      // Auto-detect completion: trust ESPN's STATUS_FINAL first (authoritative).
      // Fall back to round-count check in case ESPN's status lags slightly.
      // Guard with hasScores to avoid vacuously-true close on tournaments with
      // no rounds yet (empty golfer array → every() trivially returns true).
      const hasScores = espnResult.golfers.some((g) => g.roundsComplete > 0);
      const allActiveFinished =
        espnResult.tournamentComplete ||
        (hasScores && espnResult.golfers.every((g) => !g.madeCut || g.roundsComplete >= 4));
      const newStatus = allActiveFinished ? "finished" : "in_progress";

      // Stamp scores_updated_at, persist the ESPN event ID, and update status
      await supabase
        .from("tournaments")
        .update({
          scores_updated_at: espnResult.fetchedAt,
          espn_event_id: espnResult.eventId,
          status: newStatus,
        })
        .eq("id", tournament.id);

      console.log(
        `[cron] ${tName}: updated ${updates.length}, unmatched ${unmatched.length}, status → ${newStatus}`,
      );

      results.push({
        tournamentId: tournament.id,
        ok: true,
        eventName: espnResult.eventName,
        updated: updates.length,
        unmatched,
        fetchedAt: espnResult.fetchedAt,
        status: newStatus,
      });
    } catch (err) {
      console.error(`[cron] Unexpected error for ${tournament.id}:`, err);
      results.push({ tournamentId: tournament.id, ok: false, error: "Unexpected error" });
    }
  }

  return NextResponse.json({ ok: true, results });
}
