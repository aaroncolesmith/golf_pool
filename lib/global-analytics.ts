import { buildLeaderboard } from "@/lib/scoring";
import type { AppState, Golfer, Tournament } from "@/lib/types";

export type TournamentResult = {
  poolId: string;
  poolName: string;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string;
  tournamentStatus: Tournament["status"];
  position: number; // 1-indexed rank
  totalEntrants: number;
  teamScore: number | null;
  userId: string;
  userName: string;
  countingGolfers: Golfer[];
  benchGolfers: Golfer[];
};

export type PlayerStats = {
  userId: string;
  userName: string;
  results: TournamentResult[];
  wins: number;
  top3: number;
  avgPosition: number;
  avgPercentileScore: number; // 0–1, higher = better, normalized for field size
  bestPosition: number;
  worstPosition: number;
  positionStdDev: number;
  totalTournaments: number;
  winRate: number;
};

export type GolferImpactRow = {
  normalizedName: string;
  displayName: string;
  timesSelected: number;
  avgScoreToPar: number | null;
  avgTeamPercentile: number | null;
  cutsMade: number;
  missedCuts: number;
  appearsOnWinners: number;
  winRate: number;
  cutRate: number;
};

export type ContrarianRow = {
  userId: string;
  userName: string;
  totalPicks: number;
  uniquePicks: number;
  uniquePickRate: number;
};

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build per-pool results for every submitted entry in every locked pool. */
export function buildGlobalResults(state: AppState): TournamentResult[] {
  const results: TournamentResult[] = [];
  const userMap = new Map(state.users.map((u) => [u.id, u]));

  for (const pool of state.pools) {
    const tournament = state.tournaments.find((t) => t.id === pool.tournamentId);
    if (!tournament || !pool.tiersSubmittedAt) continue;

    const leaderboard = buildLeaderboard(state, pool);
    if (leaderboard.length === 0) continue;

    leaderboard.forEach((row, idx) => {
      results.push({
        poolId: pool.id,
        poolName: pool.name,
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        tournamentDate: tournament.startDate,
        tournamentStatus: tournament.status,
        position: idx + 1,
        totalEntrants: leaderboard.length,
        teamScore: row.teamScore,
        userId: row.userId,
        userName: userMap.get(row.userId)?.userName ?? row.teamName,
        countingGolfers: row.countingGolfers,
        benchGolfers: row.benchGolfers,
      });
    });
  }

  return results;
}

/** Aggregate per-player stats across all tournaments, sorted by performance. */
export function buildPlayerStats(results: TournamentResult[]): PlayerStats[] {
  const byUser = new Map<string, TournamentResult[]>();
  for (const r of results) {
    const arr = byUser.get(r.userId) ?? [];
    arr.push(r);
    byUser.set(r.userId, arr);
  }

  return [...byUser.values()]
    .map((userResults) => {
      const positions = userResults.map((r) => r.position);
      const percentiles = userResults.map(
        (r) => (r.totalEntrants - r.position + 1) / r.totalEntrants,
      );
      const wins = userResults.filter((r) => r.position === 1).length;
      return {
        userId: userResults[0].userId,
        userName: userResults[0].userName,
        results: [...userResults].sort((a, b) =>
          a.tournamentDate.localeCompare(b.tournamentDate),
        ),
        wins,
        top3: userResults.filter((r) => r.position <= 3).length,
        avgPosition: positions.reduce((a, b) => a + b, 0) / positions.length,
        avgPercentileScore:
          percentiles.reduce((a, b) => a + b, 0) / percentiles.length,
        bestPosition: Math.min(...positions),
        worstPosition: Math.max(...positions),
        positionStdDev: stdDev(positions),
        totalTournaments: userResults.length,
        winRate: wins / userResults.length,
      };
    })
    .sort((a, b) => {
      if (Math.abs(b.avgPercentileScore - a.avgPercentileScore) > 0.001)
        return b.avgPercentileScore - a.avgPercentileScore;
      return a.avgPosition - b.avgPosition;
    });
}

/**
 * Which golfers help or hurt teams across all pools.
 * Groups by normalized name so the same golfer is tracked across tournaments.
 */
export function buildGolferImpact(results: TournamentResult[]): GolferImpactRow[] {
  const map = new Map<
    string,
    {
      displayName: string;
      scores: number[];
      teamPercentiles: number[];
      madeCut: number;
      missedCut: number;
      onWinners: number;
    }
  >();

  for (const r of results) {
    const teamPercentile = (r.totalEntrants - r.position + 1) / r.totalEntrants;
    for (const g of [...r.countingGolfers, ...r.benchGolfers]) {
      const key = normalizeName(g.name);
      const rec = map.get(key) ?? {
        displayName: g.name,
        scores: [],
        teamPercentiles: [],
        madeCut: 0,
        missedCut: 0,
        onWinners: 0,
      };
      if (g.madeCut) {
        rec.scores.push(g.currentScoreToPar);
        rec.madeCut++;
      } else {
        rec.missedCut++;
      }
      rec.teamPercentiles.push(teamPercentile);
      if (r.position === 1) rec.onWinners++;
      map.set(key, rec);
    }
  }

  const threshold = results.length >= 10 ? 2 : 1;
  return [...map.entries()]
    .filter(([, rec]) => rec.madeCut + rec.missedCut >= threshold)
    .map(([normalizedName, rec]) => {
      const total = rec.madeCut + rec.missedCut;
      return {
        normalizedName,
        displayName: rec.displayName,
        timesSelected: total,
        avgScoreToPar:
          rec.scores.length > 0
            ? rec.scores.reduce((a, b) => a + b, 0) / rec.scores.length
            : null,
        avgTeamPercentile:
          rec.teamPercentiles.length > 0
            ? rec.teamPercentiles.reduce((a, b) => a + b, 0) / rec.teamPercentiles.length
            : null,
        cutsMade: rec.madeCut,
        missedCuts: rec.missedCut,
        appearsOnWinners: rec.onWinners,
        winRate: total > 0 ? rec.onWinners / total : 0,
        cutRate: total > 0 ? rec.madeCut / total : 0,
      };
    });
}

/** Win/loss records between every pair of players who shared a pool. */
export function buildHeadToHead(
  results: TournamentResult[],
): Map<string, Map<string, { wins: number; losses: number; ties: number }>> {
  const byPool = new Map<string, TournamentResult[]>();
  for (const r of results) {
    const arr = byPool.get(r.poolId) ?? [];
    arr.push(r);
    byPool.set(r.poolId, arr);
  }

  const h2h = new Map<
    string,
    Map<string, { wins: number; losses: number; ties: number }>
  >();

  function getRecord(a: string, b: string) {
    if (!h2h.has(a)) h2h.set(a, new Map());
    const inner = h2h.get(a)!;
    if (!inner.has(b)) inner.set(b, { wins: 0, losses: 0, ties: 0 });
    return inner.get(b)!;
  }

  for (const [, poolResults] of byPool) {
    for (let i = 0; i < poolResults.length; i++) {
      for (let j = i + 1; j < poolResults.length; j++) {
        const a = poolResults[i];
        const b = poolResults[j];
        if (a.userId === b.userId) continue;
        const ab = getRecord(a.userId, b.userId);
        const ba = getRecord(b.userId, a.userId);
        if (a.position < b.position) {
          ab.wins++;
          ba.losses++;
        } else if (b.position < a.position) {
          ab.losses++;
          ba.wins++;
        } else {
          ab.ties++;
          ba.ties++;
        }
      }
    }
  }

  return h2h;
}

/**
 * "Contrarian" score — what % of each player's picks were unique in their pool/tier.
 * Higher = more willing to go against the field.
 */
export function buildContrarianStats(
  results: TournamentResult[],
  state: AppState,
): ContrarianRow[] {
  const byPool = new Map<string, TournamentResult[]>();
  for (const r of results) {
    const arr = byPool.get(r.poolId) ?? [];
    arr.push(r);
    byPool.set(r.poolId, arr);
  }

  const userTotals = new Map<
    string,
    { userId: string; userName: string; total: number; unique: number }
  >();

  for (const [poolId, poolResults] of byPool) {
    const entries = state.entries.filter((e) => e.poolId === poolId && e.submittedAt);

    // Count how many players picked each golfer per tier
    const tierGolferCounts = new Map<string, Map<string, number>>();
    for (const entry of entries) {
      for (const sel of entry.selections) {
        const tierMap = tierGolferCounts.get(sel.tierId) ?? new Map<string, number>();
        tierMap.set(sel.golferId, (tierMap.get(sel.golferId) ?? 0) + 1);
        tierGolferCounts.set(sel.tierId, tierMap);
      }
    }

    for (const result of poolResults) {
      const entry = entries.find((e) => e.userId === result.userId);
      if (!entry) continue;

      const rec = userTotals.get(result.userId) ?? {
        userId: result.userId,
        userName: result.userName,
        total: 0,
        unique: 0,
      };

      for (const sel of entry.selections) {
        const count = tierGolferCounts.get(sel.tierId)?.get(sel.golferId) ?? 1;
        rec.total++;
        if (count === 1) rec.unique++;
      }

      userTotals.set(result.userId, rec);
    }
  }

  return [...userTotals.values()].map((rec) => ({
    userId: rec.userId,
    userName: rec.userName,
    totalPicks: rec.total,
    uniquePicks: rec.unique,
    uniquePickRate: rec.total > 0 ? rec.unique / rec.total : 0,
  }));
}
