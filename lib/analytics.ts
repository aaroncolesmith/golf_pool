/**
 * Analytics utilities: pick-similarity (kernel PCA) and ownership stats.
 * Pure functions — safe to import from client or server components.
 */

import type { Pool, PoolEntry, Golfer, LeaderboardRow, User } from "@/lib/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OwnershipPoint = {
  golferId: string;
  name: string;
  /** Number of submitted entries that include this golfer */
  ownership: number;
  /** ownership / total submitted entries (0–1) */
  ownershipPct: number;
  scoreToPar: number;
  position: string;
  madeCut: boolean;
  impliedProbability: number;
  pickedByTeams: string[];
};

export type SimilarityPoint = {
  teamName: string;
  /** Kernel-PCA coordinate 1 */
  x: number;
  /** Kernel-PCA coordinate 2 */
  y: number;
  teamScore: number | null;
  status: "live" | "locked" | "eliminated";
  /** Ordered list of golfer names this entry selected */
  picks: string[];
};

// ---------------------------------------------------------------------------
// Internal: kernel PCA helpers
// ---------------------------------------------------------------------------

function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  return n < 1e-12 ? v.map(() => 0) : v.map((x) => x / n);
}

function matVec(M: number[][], v: number[]): number[] {
  return M.map((row) => dot(row, v));
}

/**
 * Power iteration for the dominant eigenvector of symmetric matrix M.
 * `deflate` removes the contribution of a previously found eigenvector,
 * giving the second eigenvector on the next call.
 */
function dominantEigenvec(M: number[][], deflate?: number[]): number[] {
  const n = M.length;
  // Deterministic, non-degenerate starting vector
  let v: number[] = Array.from({ length: n }, (_, i) =>
    i % 3 === 0 ? 1.0 : i % 3 === 1 ? 0.5 : -0.5,
  );
  if (deflate) {
    const d = dot(v, deflate);
    v = v.map((x, i) => x - d * deflate[i]);
  }
  v = normalize(v);

  for (let iter = 0; iter < 400; iter++) {
    let next = matVec(M, v);
    if (deflate) {
      const d = dot(next, deflate);
      next = next.map((x, i) => x - d * deflate[i]);
    }
    const normed = normalize(next);
    const delta = normed.reduce((s, x, i) => s + Math.abs(x - v[i]), 0);
    v = normed;
    if (delta < 1e-10) break;
  }
  return v;
}

/**
 * Double-center a symmetric n×n matrix K → H K H
 * where H = I − (1/n)·11ᵀ  (the centering matrix).
 */
function doubleCenter(K: number[][]): number[][] {
  const n = K.length;
  const rowMean = K.map((row) => row.reduce((s, x) => s + x, 0) / n);
  const grandMean = rowMean.reduce((s, x) => s + x, 0) / n;
  return K.map((row, i) =>
    row.map((v, j) => v - rowMean[i] - rowMean[j] + grandMean),
  );
}

/**
 * Kernel PCA: projects n-team binary pick matrix X (n × m) to 2-D.
 *
 * We build the (n × n) kernel K[i][j] = shared-golfer-count between i and j,
 * double-center it, then extract the top-2 eigenvectors.
 * Coordinates are scaled by sqrt(eigenvalue) so spread ∝ variance explained.
 */
function kernelPca2d(X: number[][]): { x: number; y: number }[] {
  const n = X.length;
  if (n < 2) return X.map(() => ({ x: 0, y: 0 }));

  // Kernel matrix
  const K = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => dot(X[i], X[j])),
  );

  const Kc = doubleCenter(K);

  const ev1 = dominantEigenvec(Kc);
  const ev2 = n > 2 ? dominantEigenvec(Kc, ev1) : ev1.map(() => 0);

  const lam1 = Math.max(dot(matVec(Kc, ev1), ev1), 0);
  const lam2 = Math.max(dot(matVec(Kc, ev2), ev2), 0);

  return Array.from({ length: n }, (_, i) => ({
    x: ev1[i] * Math.sqrt(lam1),
    y: ev2[i] * Math.sqrt(lam2),
  }));
}

// ---------------------------------------------------------------------------
// Public: pick similarity (PCA scatter)
// ---------------------------------------------------------------------------

export function computePickSimilarity(
  entries: PoolEntry[],
  pool: Pool,
  golferMap: Map<string, Golfer>,
  users: User[],
  leaderboard: LeaderboardRow[],
): SimilarityPoint[] {
  const submitted = entries.filter(
    (e) => e.poolId === pool.id && e.submittedAt !== null,
  );
  if (submitted.length < 2) return [];

  // Stable ordered list of every golfer ID that appears in any entry
  const golferIds = Array.from(
    new Set(submitted.flatMap((e) => e.selections.map((s) => s.golferId))),
  );

  const userMap = new Map(users.map((u) => [u.id, u]));

  // Binary matrix rows = entries, cols = golfers
  const X = submitted.map((entry) => {
    const picked = new Set(entry.selections.map((s) => s.golferId));
    return golferIds.map((gid) => (picked.has(gid) ? 1 : 0));
  });

  const coords = kernelPca2d(X);

  return submitted.map((entry, i) => {
    const lbRow = leaderboard.find((r) => r.userId === entry.userId);
    const teamName =
      lbRow?.teamName ??
      userMap.get(entry.userId)?.userName ??
      "Unknown";
    const picks = entry.selections
      .map((s) => golferMap.get(s.golferId)?.name ?? "")
      .filter(Boolean);

    return {
      teamName,
      x: coords[i].x,
      y: coords[i].y,
      teamScore: lbRow?.teamScore ?? null,
      status: lbRow?.status ?? "live",
      picks,
    };
  });
}

// ---------------------------------------------------------------------------
// Public: ownership × performance
// ---------------------------------------------------------------------------

export function computeOwnershipStats(
  entries: PoolEntry[],
  pool: Pool,
  golferMap: Map<string, Golfer>,
  users: User[],
  leaderboard: LeaderboardRow[],
): OwnershipPoint[] {
  const submitted = entries.filter(
    (e) => e.poolId === pool.id && e.submittedAt !== null,
  );
  const total = submitted.length;
  if (total === 0) return [];

  const userMap = new Map(users.map((u) => [u.id, u]));
  const ownerMap = new Map<string, { count: number; teams: string[] }>();

  for (const entry of submitted) {
    const teamName =
      leaderboard.find((r) => r.userId === entry.userId)?.teamName ??
      userMap.get(entry.userId)?.userName ??
      "Unknown";
    for (const sel of entry.selections) {
      const rec = ownerMap.get(sel.golferId) ?? { count: 0, teams: [] };
      rec.count += 1;
      rec.teams.push(teamName);
      ownerMap.set(sel.golferId, rec);
    }
  }

  const results: OwnershipPoint[] = [];
  for (const [golferId, { count, teams }] of ownerMap) {
    const g = golferMap.get(golferId);
    if (!g) continue;
    results.push({
      golferId,
      name: g.name,
      ownership: count,
      ownershipPct: count / total,
      scoreToPar: g.currentScoreToPar,
      position: g.position,
      madeCut: g.madeCut,
      impliedProbability: g.impliedProbability,
      pickedByTeams: teams,
    });
  }

  return results.sort((a, b) => b.ownership - a.ownership);
}
