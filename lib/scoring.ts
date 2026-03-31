import { AppState, Golfer, LeaderboardRow, Pool, PoolEntry } from "@/lib/types";

function sortGolfersByScore(golfers: Golfer[]) {
  return [...golfers].sort((a, b) => a.currentScoreToPar - b.currentScoreToPar);
}

export function buildLeaderboard(state: AppState, pool: Pool): LeaderboardRow[] {
  const entries = state.entries.filter((entry) => entry.poolId === pool.id && entry.submittedAt);

  return entries
    .map((entry) => createLeaderboardRow(state, entry))
    .sort((a, b) => {
      if (a.teamScore === null && b.teamScore === null) {
        return a.teamName.localeCompare(b.teamName);
      }
      if (a.teamScore === null) {
        return 1;
      }
      if (b.teamScore === null) {
        return -1;
      }
      return a.teamScore - b.teamScore;
    });
}

function createLeaderboardRow(state: AppState, entry: PoolEntry): LeaderboardRow {
  const user = state.users.find((candidate) => candidate.id === entry.userId);
  const golfers = entry.selections
    .map((selection) => state.golfers.find((golfer) => golfer.id === selection.golferId))
    .filter((golfer): golfer is Golfer => Boolean(golfer));

  const madeCutGolfers = golfers.filter((golfer) => golfer.madeCut);

  if (madeCutGolfers.length < 4) {
    return {
      entryId: entry.id,
      userId: entry.userId,
      teamName: user?.userName ?? "Unknown",
      countingGolfers: [],
      benchGolfers: golfers,
      teamScore: null,
      status: "eliminated",
    };
  }

  const ordered = sortGolfersByScore(madeCutGolfers);
  const countingGolfers = ordered.slice(0, 4);
  const benchGolfers = golfers.filter((golfer) => !countingGolfers.some((counting) => counting.id === golfer.id));
  const teamScore = countingGolfers.reduce((sum, golfer) => sum + golfer.currentScoreToPar, 0);

  return {
    entryId: entry.id,
    userId: entry.userId,
    teamName: user?.userName ?? "Unknown",
    countingGolfers,
    benchGolfers,
    teamScore,
    status: "live",
  };
}
