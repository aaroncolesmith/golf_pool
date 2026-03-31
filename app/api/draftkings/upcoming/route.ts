import { NextResponse } from "next/server";
import { getUpcomingDraftKingsTournaments } from "@/lib/draftkings";

export const revalidate = 1800;

export async function GET() {
  try {
    const tournaments = await getUpcomingDraftKingsTournaments();
    return NextResponse.json({ tournaments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load DraftKings tournaments.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

