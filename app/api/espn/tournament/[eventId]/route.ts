import { NextResponse } from "next/server";
import { importEspnTournament } from "@/lib/espn";

export async function GET(_: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId } = await params;
    const feed = await importEspnTournament(eventId);
    return NextResponse.json(feed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to import ESPN tournament.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
