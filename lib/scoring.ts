import { AppState, Golfer, LeaderboardRow, Pool, PoolEntry } from "@/lib/types";

// Primary: top 4 (team score). Tiebreakers in order: top 3, top 2, top 1, top 5, top 6.
const TIEBREAK_ORDER = [4, 3, 2, 1, 5, 6];

function topNScore(scores: number[], n: number): number {
  return scores.slice(0, n).reduce((s, v) => s + v, 0);
}

function sortedMadeCutScores(golfers: Golfer[]): number[] {
  return golfers
    .filter((g) => g.madeCut)
    .map((g) => g.currentScoreToPar)
    .sort((a, b) => a - b);
}

export function buildLeaderboard(state: AppState, pool: Pool): LeaderboardRow[] {
  const entries = state.entries.filter((entry) => entry.poolId === pool.id && entry.submittedAt);
  const rows = entries.map((entry) => createLeaderboardRow(state, entry));

  // Pre-compute each row's sorted made-cut golfer scores for tiebreaker comparisons
  const scoreMap = new Map<string, number[]>();
  for (const row of rows) {
    scoreMap.set(row.entryId, sortedMadeCutScores([...row.countingGolfers, ...row.benchGolfers]));
  }

  rows.sort((a, b) => {
    if (a.teamScore === null && b.teamScore === null) return a.teamName.localeCompare(b.teamName);
    if (a.teamScore === null) return 1;
    if (b.teamScore === null) return -1;
    const aScores = scoreMap.get(a.entryId) ?? [];
    const bScores = scoreMap.get(b.entryId) ?? [];
    for (const n of TIEBREAK_ORDER) {
      const diff = topNScore(aScores, n) - topNScore(bScores, n);
      if (diff !== 0) return diff;
    }
    return a.teamName.localeCompare(b.teamName);
  });

  // Annotate each row with the first tiebreaker level that distinguishes it
  // from any other row sharing the same top-4 score.
  for (const row of rows) {
    if (row.teamScore === null) continue;
    const rivals = rows.filter((r) => r.entryId !== row.entryId && r.teamScore === row.teamScore);
    if (rivals.length === 0) continue;
    const myScores = scoreMap.get(row.entryId) ?? [];
    for (const n of [3, 2, 1, 5, 6]) {
      const myTopN = topNScore(myScores, n);
      const differsFromAny = rivals.some(
        (r) => topNScore(scoreMap.get(r.entryId) ?? [], n) !== myTopN,
      );
      if (differsFromAny) {
        row.tiebreakerUsed = n;
        break;
      }
    }
  }

  return rows;
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
      tiebreakerUsed: null,
    };
  }

  const ordered = [...madeCutGolfers].sort((a, b) => a.currentScoreToPar - b.currentScoreToPar);
  const countingGolfers = ordered.slice(0, 4);
  const benchGolfers = golfers.filter((g) => !countingGolfers.some((c) => c.id === g.id));
  const teamScore = countingGolfers.reduce((sum, g) => sum + g.currentScoreToPar, 0);

  return {
    entryId: entry.id,
    userId: entry.userId,
    teamName: user?.userName ?? "Unknown",
    countingGolfers,
    benchGolfers,
    teamScore,
    status: "live",
    tiebreakerUsed: null,
  };
}
