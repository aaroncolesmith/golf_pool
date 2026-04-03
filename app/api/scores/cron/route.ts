import { NextResponse } from "next/server";
import { fetchEspnScores, normalizeGolferName } from "@/lib/espn";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/scores/cron
 *
 * Called by GitHub Actions on a schedule during tournament rounds.
 * Syncs ESPN scores for every tournament currently marked `in_progress`.
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

  // Find all in-progress tournaments
  const { data: tournaments, error: tError } = await supabase
    .from("tournaments")
    .select("id, name")
    .eq("status", "in_progress");

  if (tError) {
    console.error("[cron] Failed to load tournaments:", tError);
    return NextResponse.json({ ok: false, error: "Failed to load tournaments." }, { status: 500 });
  }

  if (!tournaments || tournaments.length === 0) {
    return NextResponse.json({ ok: true, results: [], message: "No tournaments in progress." });
  }

  const results = [];

  for (const tournament of tournaments) {
    try {
      const espnResult = await fetchEspnScores(tournament.name as string);
      if (!espnResult) {
        console.warn(`[cron] ESPN returned no data for tournament: ${tournament.name}`);
        results.push({ tournamentId: tournament.id, ok: false, error: "No ESPN data" });
        continue;
      }

      // Load our golfers for this tournament
      const { data: ourGolfers, error: gError } = await supabase
        .from("golfers")
        .select("id, name")
        .eq("tournament_id", tournament.id);

      if (gError || !ourGolfers) {
        console.error(`[cron] Failed to load golfers for ${tournament.id}:`, gError);
        results.push({ tournamentId: tournament.id, ok: false, error: "Failed to load golfers" });
        continue;
      }

      // Build normalized-name → id map
      const golferMap = new Map<string, string>();
      for (const g of ourGolfers) {
        golferMap.set(normalizeGolferName(g.name as string), g.id as string);
      }

      // Match ESPN golfers to our golfers
      const updates: Array<{
        id: string;
        current_score_to_par: number;
        position: string;
        made_cut: boolean;
        rounds_complete: number;
      }> = [];
      const unmatched: string[] = [];

      for (const espnGolfer of espnResult.golfers) {
        const normalized = normalizeGolferName(espnGolfer.displayName);
        let golferId = golferMap.get(normalized);

        // Fallback: last name only
        if (!golferId) {
          const lastName = normalized.split(" ").at(-1) ?? "";
          for (const [key, id] of golferMap) {
            if (key.endsWith(` ${lastName}`) || key === lastName) {
              golferId = id;
              break;
            }
          }
        }

        if (!golferId) {
          unmatched.push(espnGolfer.displayName);
          continue;
        }

        updates.push({
          id: golferId,
          current_score_to_par: espnGolfer.scoreToParInt,
          position: espnGolfer.position,
          made_cut: espnGolfer.madeCut,
          rounds_complete: espnGolfer.roundsComplete,
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

      // Stamp scores_updated_at
      await supabase
        .from("tournaments")
        .update({ scores_updated_at: espnResult.fetchedAt })
        .eq("id", tournament.id);

      console.log(
        `[cron] ${tournament.name}: updated ${updates.length}, unmatched ${unmatched.length}`,
      );

      results.push({
        tournamentId: tournament.id,
        ok: true,
        eventName: espnResult.eventName,
        updated: updates.length,
        unmatched,
        fetchedAt: espnResult.fetchedAt,
      });
    } catch (err) {
      console.error(`[cron] Unexpected error for ${tournament.id}:`, err);
      results.push({ tournamentId: tournament.id, ok: false, error: "Unexpected error" });
    }
  }

  return NextResponse.json({ ok: true, results });
}
