"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
} from "recharts";
import {
  computeOwnershipStats,
  computePickSimilarity,
  type OwnershipPoint,
  type SimilarityPoint,
} from "@/lib/analytics";
import type { DKOddsGolfer } from "@/app/api/draftkings-odds/route";
import type { Golfer, LeaderboardRow, Pool, PoolEntry, Tournament, User } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OddsSort = "cut" | "top10" | "top5" | "win";

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function teamScoreColor(score: number | null, status: string): string {
  if (status === "eliminated") return "#9ca8b6";
  if (score === null) return "#8fb4e3";
  if (score < -6) return "#0a6e48";
  if (score < -2) return "#0f8f5f";
  if (score < 0) return "#4aaa80";
  if (score === 0) return "#8fb4e3";
  if (score < 3) return "#d08050";
  if (score < 6) return "#a84534";
  return "#7a2020";
}

function probColor(p: number | null): string {
  if (p === null) return "#9ca8b6";
  if (p >= 0.7) return "#0f8f5f";
  if (p >= 0.5) return "#3aaa70";
  if (p >= 0.3) return "#a07020";
  if (p >= 0.1) return "#c06030";
  return "#a84534";
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreStr(score: number | null, eliminated?: boolean): string {
  if (eliminated) return "Out";
  if (score === null || score === 0) return "E";
  return score > 0 ? `+${score}` : `${score}`;
}

function pctStr(p: number | null): string {
  if (p === null) return "—";
  return `${Math.round(p * 100)}%`;
}

// ---------------------------------------------------------------------------
// Custom scatter dot — renders circle + label in one <g>
// ---------------------------------------------------------------------------

function TeamDot(props: {
  cx?: number;
  cy?: number;
  payload?: SimilarityPoint;
}) {
  const { cx = 0, cy = 0, payload } = props;
  if (!payload) return null;
  const fill = teamScoreColor(payload.teamScore, payload.status);
  const label =
    payload.teamName.length > 14
      ? payload.teamName.slice(0, 13) + "…"
      : payload.teamName;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={9}
        fill={fill}
        stroke="white"
        strokeWidth={2}
        style={{ cursor: "default" }}
      />
      <text
        x={cx}
        y={cy - 14}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill="#15202b"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {label}
      </text>
    </g>
  );
}

function GolferDot(props: {
  cx?: number;
  cy?: number;
  payload?: OwnershipPoint;
}) {
  const { cx = 0, cy = 0, payload } = props;
  if (!payload) return null;
  const fill = payload.madeCut ? "#0f8f5f" : "#9ca8b6";
  const parts = payload.name.split(" ");
  const label = parts[parts.length - 1];
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={7}
        fill={fill}
        stroke="white"
        strokeWidth={2}
        style={{ cursor: "default" }}
      />
      <text
        x={cx}
        y={cy - 12}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill="#15202b"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {label}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Tooltip content
// ---------------------------------------------------------------------------

function TeamTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: SimilarityPoint }[];
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const p = payload[0].payload;
  return (
    <div
      style={{
        background: "white",
        border: "1px solid rgba(21,32,43,0.12)",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 12,
        boxShadow: "0 4px 16px rgba(23,49,83,0.1)",
        maxWidth: 200,
      }}
    >
      <p style={{ fontWeight: 800, marginBottom: 6, fontSize: 13 }}>
        {p.teamName}
        <span style={{ fontWeight: 500, marginLeft: 8, color: "#667487" }}>
          {scoreStr(p.teamScore, p.status === "eliminated")}
        </span>
      </p>
      {p.picks.map((name, i) => (
        <p key={i} style={{ color: "#667487", marginBottom: 2 }}>
          {name}
        </p>
      ))}
    </div>
  );
}

function GolferTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: OwnershipPoint }[];
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const p = payload[0].payload;
  return (
    <div
      style={{
        background: "white",
        border: "1px solid rgba(21,32,43,0.12)",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 12,
        boxShadow: "0 4px 16px rgba(23,49,83,0.1)",
        maxWidth: 200,
      }}
    >
      <p style={{ fontWeight: 800, marginBottom: 4, fontSize: 13 }}>
        {p.name}
        <span style={{ fontWeight: 500, marginLeft: 8, color: "#667487" }}>
          {scoreStr(p.scoreToPar)} · {p.position}
        </span>
      </p>
      <p style={{ color: "#667487", marginBottom: 2 }}>
        {p.ownership} team{p.ownership !== 1 ? "s" : ""} ({Math.round(p.ownershipPct * 100)}%)
      </p>
      <p style={{ color: "#667487", fontSize: 11 }}>
        {p.pickedByTeams.join(", ")}
      </p>
      {!p.madeCut && (
        <p style={{ color: "#a84534", marginTop: 4, fontWeight: 700 }}>
          {p.position}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper — uses analytics CSS classes
// ---------------------------------------------------------------------------

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="analytics-section">
      <div className="analytics-section-header">
        <p className="analytics-section-title">{title}</p>
        {subtitle && <p className="analytics-section-subtitle">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Pick Similarity scatter
// ---------------------------------------------------------------------------

function PickSimilarityChart({ data }: { data: SimilarityPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="analytics-unavailable">
        <span>📊</span>
        <span>Need at least 2 submitted teams to compute similarity.</span>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 32, right: 20, bottom: 20, left: 20 }}>
          <XAxis type="number" dataKey="x" hide domain={["auto", "auto"]} />
          <YAxis type="number" dataKey="y" hide domain={["auto", "auto"]} />
          <ReferenceLine x={0} stroke="rgba(21,32,43,0.07)" />
          <ReferenceLine y={0} stroke="rgba(21,32,43,0.07)" />
          <Tooltip content={<TeamTooltip />} cursor={false} />
          <Scatter data={data} shape={<TeamDot />} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. DraftKings Odds section
// ---------------------------------------------------------------------------

const SORT_LABELS: Record<OddsSort, string> = {
  cut: "Make Cut",
  top10: "Top 10",
  top5: "Top 5",
  win: "Win",
};

function avgProb(
  golfers: Golfer[],
  oddsMap: Map<string, DKOddsGolfer>,
  key: keyof Pick<DKOddsGolfer, "cut" | "top5" | "top10" | "win">,
): number | null {
  const vals: number[] = [];
  for (const g of golfers) {
    const entry = lookupOdds(g.name, oddsMap);
    const v = entry?.[key];
    if (v !== null && v !== undefined) vals.push(v);
  }
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function lookupOdds(
  name: string,
  oddsMap: Map<string, DKOddsGolfer>,
): DKOddsGolfer | undefined {
  const norm = normalizeName(name);
  if (oddsMap.has(norm)) return oddsMap.get(norm);
  // Last-name fallback
  const lastName = norm.split(" ").at(-1) ?? "";
  for (const [key, val] of oddsMap) {
    if (key.endsWith(` ${lastName}`) || key === lastName) return val;
  }
  return undefined;
}

function ProbCell({ value }: { value: number | null }) {
  return (
    <span
      style={{
        color: probColor(value),
        fontWeight: value !== null ? 700 : 400,
        fontSize: "0.78rem",
        minWidth: 36,
        textAlign: "right",
        display: "inline-block",
      }}
    >
      {pctStr(value)}
    </span>
  );
}

function DraftKingsOddsSection({
  leaderboard,
  golferMap,
  oddsData,
  oddsLoading,
  sortBy,
  onSortChange,
}: {
  leaderboard: LeaderboardRow[];
  golferMap: Map<string, Golfer>;
  oddsData: DKOddsGolfer[] | null;
  oddsLoading: boolean;
  sortBy: OddsSort;
  onSortChange: (s: OddsSort) => void;
}) {
  const oddsMap = useMemo(() => {
    if (!oddsData) return new Map<string, DKOddsGolfer>();
    return new Map(oddsData.map((g) => [normalizeName(g.name), g]));
  }, [oddsData]);

  const sortedRows = useMemo(() => {
    const rows = leaderboard.filter((r) => r.status !== "eliminated");
    if (!oddsData) return rows;
    return [...rows].sort((a, b) => {
      const allA = [...a.countingGolfers, ...a.benchGolfers];
      const allB = [...b.countingGolfers, ...b.benchGolfers];
      const avgA = avgProb(allA, oddsMap, sortBy) ?? -1;
      const avgB = avgProb(allB, oddsMap, sortBy) ?? -1;
      return avgB - avgA;
    });
  }, [leaderboard, oddsData, oddsMap, sortBy]);

  if (oddsLoading) {
    return (
      <div className="analytics-unavailable">
        <span
          style={{
            display: "inline-block",
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "2px solid var(--primary)",
            borderTopColor: "transparent",
            animation: "spin 0.7s linear infinite",
          }}
        />
        <span>Loading DraftKings odds…</span>
      </div>
    );
  }

  if (!oddsData) {
    return (
      <div className="analytics-unavailable">
        <span>🔌</span>
        <span>
          DraftKings odds are only available for DraftKings-imported tournaments with an active market.
        </span>
      </div>
    );
  }

  const COLS: { key: OddsSort; label: string }[] = [
    { key: "cut", label: "Cut" },
    { key: "top10", label: "Top 10" },
    { key: "top5", label: "Top 5" },
    { key: "win", label: "Win" },
  ];

  return (
    <div>
      {/* Sort controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "0.78rem",
            fontWeight: 600,
            color: "#667487",
            marginRight: 2,
          }}
        >
          Sort teams by:
        </span>
        {COLS.map((col) => (
          <button
            key={col.key}
            type="button"
            onClick={() => onSortChange(col.key)}
            style={{
              padding: "4px 12px",
              borderRadius: 20,
              border: "1px solid",
              fontSize: "0.78rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s",
              borderColor: sortBy === col.key ? "var(--primary)" : "var(--line)",
              background: sortBy === col.key ? "var(--primary-soft)" : "transparent",
              color: sortBy === col.key ? "var(--primary)" : "var(--muted)",
            }}
          >
            {col.label} %
          </button>
        ))}
      </div>

      {/* Team cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sortedRows.map((row, rank) => {
          const allGolfers = [...row.countingGolfers, ...row.benchGolfers];

          // Compute team averages
          const teamAvg: Record<OddsSort, number | null> = {
            cut: avgProb(allGolfers, oddsMap, "cut"),
            top10: avgProb(allGolfers, oddsMap, "top10"),
            top5: avgProb(allGolfers, oddsMap, "top5"),
            win: avgProb(allGolfers, oddsMap, "win"),
          };

          return (
            <div
              key={row.entryId}
              style={{
                background: "#f8fafd",
                border: "1px solid var(--line)",
                borderRadius: 14,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 0,
              }}
            >
              {/* Team header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingBottom: 10,
                  marginBottom: 8,
                  borderBottom: "1px solid var(--line)",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "var(--primary-soft)",
                      color: "var(--primary)",
                      fontSize: "0.68rem",
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {rank + 1}
                  </span>
                  <span
                    style={{
                      fontWeight: 800,
                      fontSize: "0.9rem",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {row.teamName}
                  </span>
                  <span style={{ fontSize: "0.78rem", color: "#667487" }}>
                    {scoreStr(row.teamScore)}
                  </span>
                </div>

                {/* Team avg probabilities */}
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  {COLS.map((col) => (
                    <span
                      key={col.key}
                      style={{
                        fontSize: "0.72rem",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 1,
                      }}
                    >
                      <span style={{ color: "#9ca8b6", fontWeight: 600 }}>
                        {col.label}
                      </span>
                      <span
                        style={{
                          color: probColor(teamAvg[col.key]),
                          fontWeight: 800,
                          fontSize: "0.82rem",
                          textDecoration:
                            col.key === sortBy ? "underline" : "none",
                          textUnderlineOffset: 2,
                        }}
                      >
                        {pctStr(teamAvg[col.key])}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Per-golfer table */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr repeat(4, 44px)",
                  gap: "3px 4px",
                  alignItems: "center",
                }}
              >
                {/* Column headers */}
                <span />
                {COLS.map((col) => (
                  <span
                    key={col.key}
                    style={{
                      fontSize: "0.65rem",
                      fontWeight: 700,
                      color: col.key === sortBy ? "var(--primary)" : "#9ca8b6",
                      textAlign: "right",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {col.label}
                  </span>
                ))}

                {/* Golfer rows */}
                {allGolfers.map((golfer) => {
                  const isBench = row.benchGolfers.some(
                    (g) => g.id === golfer.id,
                  );
                  const odds = lookupOdds(golfer.name, oddsMap);
                  return (
                    <>
                      <span
                        key={`name-${golfer.id}`}
                        style={{
                          fontSize: "0.82rem",
                          fontWeight: isBench ? 400 : 600,
                          color: !golfer.madeCut
                            ? "#9ca8b6"
                            : isBench
                              ? "#667487"
                              : "var(--text)",
                          textDecoration: !golfer.madeCut
                            ? "line-through"
                            : "none",
                          paddingRight: 4,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {golfer.name}
                        {isBench && (
                          <span
                            style={{
                              marginLeft: 4,
                              fontSize: "0.65rem",
                              color: "#9ca8b6",
                              fontWeight: 400,
                            }}
                          >
                            bench
                          </span>
                        )}
                      </span>
                      <span
                        key={`cut-${golfer.id}`}
                        style={{
                          textAlign: "right",
                          opacity: isBench ? 0.6 : 1,
                        }}
                      >
                        <ProbCell value={odds?.cut ?? null} />
                      </span>
                      <span
                        key={`top10-${golfer.id}`}
                        style={{
                          textAlign: "right",
                          opacity: isBench ? 0.6 : 1,
                        }}
                      >
                        <ProbCell value={odds?.top10 ?? null} />
                      </span>
                      <span
                        key={`top5-${golfer.id}`}
                        style={{
                          textAlign: "right",
                          opacity: isBench ? 0.6 : 1,
                        }}
                      >
                        <ProbCell value={odds?.top5 ?? null} />
                      </span>
                      <span
                        key={`win-${golfer.id}`}
                        style={{
                          textAlign: "right",
                          opacity: isBench ? 0.6 : 1,
                        }}
                      >
                        <ProbCell value={odds?.win ?? null} />
                      </span>
                    </>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Ownership × Performance
// ---------------------------------------------------------------------------

function OwnershipChart({ data }: { data: OwnershipPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="analytics-unavailable">
        <span>⛳</span>
        <span>No submitted picks yet.</span>
      </div>
    );
  }

  const maxOwnership = Math.max(...data.map((d) => d.ownership));
  const scores = data.map((d) => d.scoreToPar);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);

  const anyMadeCut = data.some((d) => d.madeCut);
  const anyMissed = data.some((d) => !d.madeCut);

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 10,
          fontSize: "0.78rem",
          color: "#667487",
        }}
      >
        {anyMadeCut && (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#0f8f5f",
              }}
            />
            Made cut
          </span>
        )}
        {anyMissed && (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#9ca8b6",
              }}
            />
            Cut / WD
          </span>
        )}
      </div>

      <div style={{ width: "100%", height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 24, right: 20, bottom: 36, left: 44 }}>
            <XAxis
              type="number"
              dataKey="ownership"
              domain={[0, maxOwnership + 0.5]}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "#667487" }}
              label={{
                value: "Teams with this pick",
                position: "insideBottom",
                offset: -18,
                fontSize: 11,
                fill: "#667487",
              }}
            />
            <YAxis
              type="number"
              dataKey="scoreToPar"
              reversed
              domain={[Math.floor(minScore) - 1, Math.ceil(maxScore) + 1]}
              tick={{ fontSize: 11, fill: "#667487" }}
              tickFormatter={(v: number) =>
                v === 0 ? "E" : v > 0 ? `+${v}` : `${v}`
              }
              label={{
                value: "Score to par",
                angle: -90,
                position: "insideLeft",
                offset: -28,
                fontSize: 11,
                fill: "#667487",
              }}
            />
            <ReferenceLine
              y={0}
              stroke="rgba(21,32,43,0.1)"
              strokeDasharray="4 4"
            />
            <Tooltip content={<GolferTooltip />} cursor={false} />
            <Scatter
              data={data}
              shape={<GolferDot />}
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function AnalyticsTab({
  leaderboard,
  entries,
  pool,
  golferMap,
  users,
  tournament,
}: {
  leaderboard: LeaderboardRow[];
  entries: PoolEntry[];
  pool: Pool;
  golferMap: Map<string, Golfer>;
  users: User[];
  tournament: Tournament;
}) {
  const [oddsData, setOddsData] = useState<DKOddsGolfer[] | null | undefined>(
    undefined,
  ); // undefined = loading, null = failed/unavailable
  const [sortBy, setSortBy] = useState<OddsSort>("cut");

  const leagueId = tournament.importMeta?.leagueId;

  useEffect(() => {
    if (!leagueId) {
      setOddsData(null);
      return;
    }
    fetch(`/api/draftkings-odds?leagueId=${leagueId}`)
      .then((r) => r.json())
      .then((body: { golfers: DKOddsGolfer[] | null }) =>
        setOddsData(body.golfers ?? null),
      )
      .catch(() => setOddsData(null));
  }, [leagueId]);

  const similarityData = useMemo(
    () => computePickSimilarity(entries, pool, golferMap, users, leaderboard),
    [entries, pool, golferMap, users, leaderboard],
  );

  const ownershipData = useMemo(
    () => computeOwnershipStats(entries, pool, golferMap, users, leaderboard),
    [entries, pool, golferMap, users, leaderboard],
  );

  const submittedCount = entries.filter(
    (e) => e.poolId === pool.id && e.submittedAt !== null,
  ).length;

  if (submittedCount === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">📊</span>
        <p style={{ fontWeight: 700 }}>No analytics yet</p>
        <p className="muted small">
          Analytics appear once members submit their picks.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <Section
        title="Pick Similarity"
        subtitle="Teams plotted by how similar their picks are. Color shows current score — darker green is better."
      >
        <PickSimilarityChart data={similarityData} />
      </Section>

      <Section
        title="DraftKings Odds"
        subtitle="Live implied probabilities from DraftKings. Sort teams by any category to see which roster has the best edge."
      >
        <DraftKingsOddsSection
          leaderboard={leaderboard}
          golferMap={golferMap}
          oddsData={oddsData ?? null}
          oddsLoading={oddsData === undefined}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />
      </Section>

      <Section
        title="Ownership vs. Score"
        subtitle="X-axis: how many teams picked each golfer. Y-axis: score to par (lower = better = higher on chart)."
      >
        <OwnershipChart data={ownershipData} />
      </Section>
    </div>
  );
}
