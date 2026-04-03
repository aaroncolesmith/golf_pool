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

function cutPctBg(pct: number): string {
  if (pct >= 0.7) return "#c8e6c9";
  if (pct >= 0.4) return "#fff9c4";
  return "#ffcdd2";
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
        r={8}
        fill={fill}
        stroke="white"
        strokeWidth={1.5}
        style={{ cursor: "default" }}
      />
      <text
        x={cx}
        y={cy - 13}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
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
  // Show last name only to save space; full name appears in tooltip
  const parts = payload.name.split(" ");
  const label = parts[parts.length - 1];
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill={fill}
        stroke="white"
        strokeWidth={1.5}
        style={{ cursor: "default" }}
      />
      <text
        x={cx}
        y={cy - 10}
        textAnchor="middle"
        fontSize={10}
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

function TeamTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: SimilarityPoint }[];
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const p = payload[0].payload;
  const scoreStr =
    p.status === "eliminated"
      ? "Out"
      : p.teamScore === null
        ? "E"
        : p.teamScore === 0
          ? "E"
          : p.teamScore > 0
            ? `+${p.teamScore}`
            : `${p.teamScore}`;
  return (
    <div
      style={{
        background: "white",
        border: "1px solid rgba(21,32,43,0.12)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        boxShadow: "0 4px 16px rgba(23,49,83,0.1)",
        maxWidth: 200,
      }}
    >
      <p style={{ fontWeight: 700, marginBottom: 4 }}>
        {p.teamName}
        <span style={{ fontWeight: 400, marginLeft: 6, color: "#667487" }}>
          {scoreStr}
        </span>
      </p>
      {p.picks.map((name, i) => (
        <p key={i} style={{ color: "#667487", marginBottom: 1 }}>
          {name}
        </p>
      ))}
    </div>
  );
}

function GolferTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: OwnershipPoint }[];
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const p = payload[0].payload;
  const scoreStr =
    p.scoreToPar === 0
      ? "E"
      : p.scoreToPar > 0
        ? `+${p.scoreToPar}`
        : `${p.scoreToPar}`;
  return (
    <div
      style={{
        background: "white",
        border: "1px solid rgba(21,32,43,0.12)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        boxShadow: "0 4px 16px rgba(23,49,83,0.1)",
        maxWidth: 200,
      }}
    >
      <p style={{ fontWeight: 700, marginBottom: 4 }}>
        {p.name}
        <span style={{ fontWeight: 400, marginLeft: 6, color: "#667487" }}>
          {scoreStr} · {p.position}
        </span>
      </p>
      <p style={{ color: "#667487", marginBottom: 1 }}>
        {p.ownership} team{p.ownership !== 1 ? "s" : ""} (
        {Math.round(p.ownershipPct * 100)}%)
      </p>
      <p style={{ color: "#667487", fontSize: 11, marginTop: 4 }}>
        {p.pickedByTeams.join(", ")}
      </p>
      {!p.madeCut && (
        <p style={{ color: "#a84534", marginTop: 4, fontWeight: 600 }}>
          {p.position}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <p
          style={{
            fontSize: "0.72rem",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#667487",
            marginBottom: 2,
          }}
        >
          {title}
        </p>
        {subtitle && (
          <p style={{ fontSize: "0.82rem", color: "#667487" }}>{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Pick Similarity
// ---------------------------------------------------------------------------

function PickSimilarityChart({
  data,
}: {
  data: SimilarityPoint[];
}) {
  if (data.length < 2) {
    return (
      <div className="empty-state" style={{ padding: "24px 0" }}>
        <p className="muted small">Need at least 2 submitted teams.</p>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 340 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 30, right: 20, bottom: 20, left: 20 }}>
          <XAxis
            type="number"
            dataKey="x"
            hide
            domain={["auto", "auto"]}
          />
          <YAxis
            type="number"
            dataKey="y"
            hide
            domain={["auto", "auto"]}
          />
          <ReferenceLine x={0} stroke="rgba(21,32,43,0.08)" />
          <ReferenceLine y={0} stroke="rgba(21,32,43,0.08)" />
          <Tooltip
            content={<TeamTooltipContent />}
            cursor={false}
          />
          <Scatter
            data={data}
            shape={<TeamDot />}
            isAnimationActive={false}
          />
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
  // Build lookup: normalized name → DataGolf golfer
  const dgLookup = useMemo(() => {
    if (!dgData) return new Map<string, DataGolfGolfer>();
    return new Map(dgData.map((g) => [normalizeName(g.name), g]));
  }, [dgData]);

  function findDg(name: string): DataGolfGolfer | undefined {
    const norm = normalizeName(name);
    if (dgLookup.has(norm)) return dgLookup.get(norm);
    // Last-name fallback
    const lastName = norm.split(" ").at(-1) ?? "";
    for (const [key, val] of dgLookup) {
      if (key.endsWith(` ${lastName}`) || key === lastName) return val;
    }
    return undefined;
  }

  if (dgLoading) {
    return (
      <p className="muted small" style={{ padding: "12px 0" }}>
        Loading DataGolf probabilities…
      </p>
    );
  }

  if (!dgData) {
    return (
      <div
        style={{
          padding: "14px 16px",
          background: "rgba(21,32,43,0.04)",
          borderRadius: 10,
          fontSize: "0.82rem",
          color: "#667487",
        }}
      >
        DataGolf live model unavailable. Data is only accessible during active
        tournament rounds.
      </div>
    );
  }

  const rows = leaderboard.filter((r) => r.status !== "eliminated");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 10,
      }}
    >
      {rows.map((row) => {
        const allGolfers = [...row.countingGolfers, ...row.benchGolfers];
        const dgGolfers = allGolfers.map((g) => ({
          golfer: g,
          dg: findDg(g.name),
        }));

        const avgCut =
          dgGolfers.reduce((s, { dg }) => s + (dg?.cut ?? 0), 0) /
          Math.max(dgGolfers.length, 1);

        const scoreStr =
          row.teamScore === null
            ? "E"
            : row.teamScore === 0
              ? "E"
              : row.teamScore > 0
                ? `+${row.teamScore}`
                : `${row.teamScore}`;

        return (
          <div
            key={row.entryId}
            style={{
              background: "white",
              border: "1px solid rgba(21,32,43,0.1)",
              borderRadius: 10,
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>
                {row.teamName}
              </span>
              <span style={{ fontSize: "0.8rem", color: "#667487" }}>
                {scoreStr} · avg cut{" "}
                <strong
                  style={{
                    color:
                      avgCut >= 0.7
                        ? "#0f8f5f"
                        : avgCut >= 0.4
                          ? "#a07020"
                          : "#a84534",
                  }}
                >
                  {Math.round(avgCut * 100)}%
                </strong>
              </span>
            </div>

            {dgGolfers.map(({ golfer, dg }) => {
              const isBench = row.benchGolfers.some((g) => g.id === golfer.id);
              return (
                <div
                  key={golfer.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    opacity: isBench ? 0.6 : 1,
                    fontSize: "0.8rem",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontWeight: isBench ? 400 : 600,
                      color: !golfer.madeCut ? "#9ca8b6" : "inherit",
                    }}
                  >
                    {golfer.name}
                    {!golfer.madeCut && (
                      <span
                        style={{ marginLeft: 4, color: "#9ca8b6", fontWeight: 400 }}
                      >
                        {golfer.position}
                      </span>
                    )}
                  </span>
                  {dg ? (
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <span
                        style={{
                          padding: "1px 5px",
                          borderRadius: 4,
                          background: cutPctBg(dg.cut),
                          fontSize: "0.72rem",
                          fontWeight: 700,
                        }}
                        title="Make cut %"
                      >
                        {Math.round(dg.cut * 100)}%
                      </span>
                      <span
                        style={{
                          padding: "1px 5px",
                          borderRadius: 4,
                          background: "rgba(28,110,231,0.08)",
                          color: "#1c6ee7",
                          fontSize: "0.72rem",
                          fontWeight: 700,
                        }}
                        title="Top 5 %"
                      >
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
      <div className="empty-state" style={{ padding: "24px 0" }}>
        <p className="muted small">No submitted picks yet.</p>
      </div>
    );
  }

  const maxOwnership = Math.max(...data.map((d) => d.ownership));
  const scores = data.map((d) => d.scoreToPar);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);

  // Color legend entries
  const anyMadeCut = data.some((d) => d.madeCut);
  const anyMissed = data.some((d) => !d.madeCut);

  return (
    <div>
      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 8,
          fontSize: "0.78rem",
          color: "#667487",
        }}
      >
        {anyMadeCut && (
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
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
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
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
          <ScatterChart margin={{ top: 24, right: 20, bottom: 32, left: 40 }}>
            <XAxis
              type="number"
              dataKey="ownership"
              domain={[0, maxOwnership + 0.5]}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "#667487" }}
              label={{
                value: "Teams with this pick",
                position: "insideBottom",
                offset: -14,
                fontSize: 11,
                fill: "#667487",
              }}
            />
            <YAxis
              type="number"
              dataKey="scoreToPar"
              reversed
              domain={[
                Math.floor(minScore) - 1,
                Math.ceil(maxScore) + 1,
              ]}
              tick={{ fontSize: 11, fill: "#667487" }}
              tickFormatter={(v: number) =>
                v === 0 ? "E" : v > 0 ? `+${v}` : `${v}`
              }
              label={{
                value: "Score to par",
                angle: -90,
                position: "insideLeft",
                offset: -24,
                fontSize: 11,
                fill: "#667487",
              }}
            />
            <ReferenceLine y={0} stroke="rgba(21,32,43,0.12)" strokeDasharray="3 3" />
            <Tooltip
              content={<GolferTooltipContent />}
              cursor={false}
            />
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
// Main AnalyticsTab
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
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* 1. Pick Similarity */}
      <Section
        title="Pick Similarity"
        subtitle="Teams closer together made similar picks. Color shows current score (green = lower is better)."
      >
        <PickSimilarityChart data={similarityData} />
      </Section>

      {/* 2. DataGolf Survival Probabilities */}
      <Section
        title="DataGolf Probabilities"
        subtitle="Cut %, Top 5 %, and Win % from DataGolf's live model. Badge color: green ≥ 70%, yellow 40–70%, red < 40%."
      >
        <DataGolfSection
          leaderboard={leaderboard}
          golferMap={golferMap}
          dgData={dgData ?? null}
          dgLoading={dgData === undefined}
        />
      </Section>

      {/* 3. Ownership × Performance */}
      <Section
        title="Ownership vs. Score"
        subtitle="X-axis: how many teams picked each golfer. Y-axis: current score (lower = better = higher on chart)."
      >
        <OwnershipChart data={ownershipData} />
      </Section>
    </div>
  );
}
