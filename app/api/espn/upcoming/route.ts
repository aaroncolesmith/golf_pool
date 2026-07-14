import { NextResponse } from "next/server";
import { getUpcomingEspnTournaments } from "@/lib/espn";

export const revalidate = 300;

export async function GET() {
  try {
    const tournaments = await getUpcomingEspnTournaments();
    return NextResponse.json({ tournaments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load ESPN tournaments.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
