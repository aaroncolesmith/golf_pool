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
import type { Golfer, LeaderboardRow, Pool, PoolEntry, User } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DataGolfGolfer = {
  name: string;
  cut: number;
  top5: number;
  win: number;
};

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

function cutBadgeClass(pct: number): string {
  if (pct >= 0.7) return "dg-badge dg-badge-cut";
  if (pct >= 0.4) return "dg-badge dg-badge-cut yellow";
  return "dg-badge dg-badge-cut red";
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
// 2. DataGolf probabilities
// ---------------------------------------------------------------------------

function DataGolfSection({
  leaderboard,
  golferMap,
  dgData,
  dgLoading,
}: {
  leaderboard: LeaderboardRow[];
  golferMap: Map<string, Golfer>;
  dgData: DataGolfGolfer[] | null;
  dgLoading: boolean;
}) {
  const dgLookup = useMemo(() => {
    if (!dgData) return new Map<string, DataGolfGolfer>();
    return new Map(dgData.map((g) => [normalizeName(g.name), g]));
  }, [dgData]);

  function findDg(name: string): DataGolfGolfer | undefined {
    const norm = normalizeName(name);
    if (dgLookup.has(norm)) return dgLookup.get(norm);
    const lastName = norm.split(" ").at(-1) ?? "";
    for (const [key, val] of dgLookup) {
      if (key.endsWith(` ${lastName}`) || key === lastName) return val;
    }
    return undefined;
  }

  if (dgLoading) {
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
        <span>Loading DataGolf probabilities…</span>
      </div>
    );
  }

  if (!dgData) {
    return (
      <div className="analytics-unavailable">
        <span>🔌</span>
        <span>
          DataGolf live model is only available during active tournament rounds.
        </span>
      </div>
    );
  }

  const rows = leaderboard.filter((r) => r.status !== "eliminated");

  return (
    <div className="dg-team-grid">
      {rows.map((row) => {
        const allGolfers = [...row.countingGolfers, ...row.benchGolfers];
        const dgGolfers = allGolfers.map((g) => ({
          golfer: g,
          dg: findDg(g.name),
        }));

        const avgCut =
          dgGolfers.reduce((s, { dg }) => s + (dg?.cut ?? 0), 0) /
          Math.max(dgGolfers.length, 1);

        return (
          <div key={row.entryId} className="dg-team-card">
            <div className="dg-team-header">
              <span className="dg-team-name">{row.teamName}</span>
              <span className="dg-team-score">
                {scoreStr(row.teamScore)}{" "}
                <span
                  style={{
                    fontWeight: 700,
                    color:
                      avgCut >= 0.7
                        ? "#0f8f5f"
                        : avgCut >= 0.4
                          ? "#a07020"
                          : "#a84534",
                  }}
                >
                  • avg {Math.round(avgCut * 100)}% cut
                </span>
              </span>
            </div>

            {dgGolfers.map(({ golfer, dg }) => {
              const isBench = row.benchGolfers.some((g) => g.id === golfer.id);
              return (
                <div
                  key={golfer.id}
                  className="dg-golfer-row"
                  style={{ opacity: isBench ? 0.6 : 1 }}
                >
                  <span
                    className="dg-golfer-name"
                    style={{
                      fontWeight: isBench ? 400 : 600,
                      color: !golfer.madeCut ? "#9ca8b6" : "inherit",
                      textDecoration: !golfer.madeCut ? "line-through" : "none",
                    }}
                  >
                    {golfer.name}
                  </span>
                  {dg ? (
                    <div className="dg-badges">
                      <span
                        className={cutBadgeClass(dg.cut)}
                        title="Make cut %"
                      >
                        {Math.round(dg.cut * 100)}%
                      </span>
                      <span className="dg-badge dg-badge-top5" title="Top 5 %">
                        T5: {Math.round(dg.top5 * 100)}%
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: "#9ca8b6", fontSize: "0.72rem" }}>—</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
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
}: {
  leaderboard: LeaderboardRow[];
  entries: PoolEntry[];
  pool: Pool;
  golferMap: Map<string, Golfer>;
  users: User[];
}) {
  const [dgData, setDgData] = useState<DataGolfGolfer[] | null | undefined>(
    undefined,
  ); // undefined = loading, null = failed/unavailable

  useEffect(() => {
    fetch("/api/datagolf")
      .then((r) => r.json())
      .then((body: { golfers: DataGolfGolfer[] | null }) =>
        setDgData(body.golfers ?? null),
      )
      .catch(() => setDgData(null));
  }, []);

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
        title="DataGolf Probabilities"
        subtitle="Cut %, Top 5 %, and Win % from DataGolf's live model. Only available during active tournament rounds."
      >
        <DataGolfSection
          leaderboard={leaderboard}
          golferMap={golferMap}
          dgData={dgData ?? null}
          dgLoading={dgData === undefined}
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
