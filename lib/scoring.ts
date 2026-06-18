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

  // Annotate tiebreaker info by comparing each consecutive adjacent pair.
  // Using adjacent pairs (not "any rival") ensures we report the level that
  // actually separated the two teams immediately next to each other in the ranking.
  // For rows involved in multiple pairs, keep the MOST SPECIFIC level (deepest in
  // TIEBREAK_ORDER), since that reflects the hardest comparison needed for that row.
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (a.teamScore === null || b.teamScore === null || a.teamScore !== b.teamScore) continue;

    const aScores = scoreMap.get(a.entryId) ?? [];
    const bScores = scoreMap.get(b.entryId) ?? [];

    let pairLevel: number | null = null;
    for (let ti = 1; ti < TIEBREAK_ORDER.length; ti++) {
      const n = TIEBREAK_ORDER[ti];
      if (topNScore(aScores, n) !== topNScore(bScores, n)) {
        pairLevel = n;
        break;
      }
    }

    if (pairLevel !== null) {
      // Score tiebreaker resolved this pair. Keep the deepest (most specific) level
      // seen across all adjacent pairs for each row.
      const levelIdx = TIEBREAK_ORDER.indexOf(pairLevel);
      const aIdx = a.tiebreakerUsed !== null ? TIEBREAK_ORDER.indexOf(a.tiebreakerUsed) : -1;
      const bIdx = b.tiebreakerUsed !== null ? TIEBREAK_ORDER.indexOf(b.tiebreakerUsed) : -1;
      if (levelIdx > aIdx) a.tiebreakerUsed = pairLevel;
      if (levelIdx > bIdx) b.tiebreakerUsed = pairLevel;
    } else {
      // No score tiebreaker can separate this pair — mark both as truly tied.
      a.trulyTied = true;
      b.trulyTied = true;
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
      trulyTied: false,
    };
  }

  const ordered = [...madeCutGolfers].sort((a, b) => a.currentScoreToPar - b.currentScoreToPar);
  const countingGolfers = ordered.slice(0, 4);
  const benchGolfers = golfers
    .filter((g) => !countingGolfers.some((c) => c.id === g.id))
    .sort((a, b) => {
      if (a.madeCut && !b.madeCut) return -1;
      if (!a.madeCut && b.madeCut) return 1;
      return a.currentScoreToPar - b.currentScoreToPar;
    });
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
    trulyTied: false,
  };
}
