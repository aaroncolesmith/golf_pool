import { NextResponse } from "next/server";
import { fetchEspnScores, normalizeGolferName } from "@/lib/espn";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST /api/scores/sync
 *
 * Body: { tournamentId: string }
 *
 * Fetches live scores from ESPN for the given tournament, matches golfers by
 * name, and writes score updates to Supabase.
 *
 * Authentication required — any pool member can trigger a sync.
 *
 * Response:
 *   { ok: true, eventName: string, updated: number, unmatched: string[] }
 *   { ok: false, error: string }
 */
export async function POST(request: Request) {
  let body: { tournamentId?: string };
  try {
    body = (await request.json()) as { tournamentId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const { tournamentId } = body;
  if (!tournamentId || typeof tournamentId !== "string") {
    return NextResponse.json({ ok: false, error: "tournamentId is required." }, { status: 400 });
  }

  // Verify the requesting user is authenticated
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }

  // Load the tournament from Supabase to get the name for ESPN matching
  const { data: tournament, error: tError } = await supabase
    .from("tournaments")
    .select("id, name")
    .eq("id", tournamentId)
    .single();

  if (tError || !tournament) {
    return NextResponse.json({ ok: false, error: "Tournament not found." }, { status: 404 });
  }

  // Fetch ESPN scores
  const espnResult = await fetchEspnScores(tournament.name as string);
  if (!espnResult) {
    return NextResponse.json(
      { ok: false, error: "Unable to fetch scores from ESPN. The tournament may not be in progress." },
      { status: 502 },
    );
  }

  // Load our golfers — include all NOT NULL columns so the upsert payload is
  // complete (PostgREST evaluates NOT NULL constraints on the INSERT branch of
  // ON CONFLICT before detecting the key conflict on some versions).
  const { data: ourGolfers, error: gError } = await supabase
    .from("golfers")
    .select("id, name, tournament_id, odds_american, implied_probability")
    .eq("tournament_id", tournamentId);

  if (gError || !ourGolfers) {
    return NextResponse.json({ ok: false, error: "Failed to load golfer list." }, { status: 500 });
  }

  type OurGolfer = {
    id: string;
    name: string;
    tournament_id: string;
    odds_american: number;
    implied_probability: number;
  };

  // Build a normalized-name → golfer map
  const golferByNorm = new Map<string, OurGolfer>();
  for (const g of ourGolfers as OurGolfer[]) {
    golferByNorm.set(normalizeGolferName(g.name), g);
  }

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
  }> = [];

  const unmatched: string[] = [];

  for (const espnGolfer of espnResult.golfers) {
    const normalized = normalizeGolferName(espnGolfer.displayName);
    let ourGolfer = golferByNorm.get(normalized);

    // Fallback: last-name-only match
    if (!ourGolfer) {
      const lastName = normalized.split(" ").at(-1) ?? "";
      for (const [key, g] of golferByNorm) {
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
    });
  }

  // Deduplicate by id — ESPN occasionally lists the same golfer twice
  const dedupedUpdates = Array.from(
    new Map(updates.map((u) => [u.id, u])).values(),
  );

  // Write score updates to Supabase in a single upsert
  if (dedupedUpdates.length > 0) {
    const { error: upsertError } = await supabase.from("golfers").upsert(dedupedUpdates, { onConflict: "id" });

    if (upsertError) {
      console.error("[sync] Upsert error:", upsertError);
      return NextResponse.json(
        { ok: false, error: `Failed to write score updates: ${upsertError.message}` },
        { status: 500 },
      );
    }
  }

  // Stamp scores_updated_at on the tournament
  await supabase
    .from("tournaments")
    .update({ scores_updated_at: espnResult.fetchedAt })
    .eq("id", tournamentId);

  return NextResponse.json({
    ok: true,
    eventName: espnResult.eventName,
    updated: updates.length,
    unmatched,
    fetchedAt: espnResult.fetchedAt,
  });
}
