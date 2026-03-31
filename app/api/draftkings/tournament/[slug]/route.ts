import { NextResponse } from "next/server";
import { importDraftKingsTournament } from "@/lib/draftkings";

export const revalidate = 1800;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const url = new URL(request.url);
    const leagueId = url.searchParams.get("leagueId") ?? undefined;
    const feed = await importDraftKingsTournament(slug, leagueId);
    return NextResponse.json(feed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import DraftKings tournament.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
