"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LabelList,
  ReferenceLine,
} from "recharts";
import { useAppState } from "@/lib/store";
import {
  buildGlobalResults,
  buildPlayerStats,
  buildGolferImpact,
  buildHeadToHead,
  buildContrarianStats,
  type PlayerStats,
  type GolferImpactRow,
  type ContrarianRow,
  type TournamentResult,
} from "@/lib/global-analytics";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYER_COLORS = [
  "#1c6ee7",
  "#e07628",
  "#2ca25f",
  "#c42872",
  "#7b2fb5",
  "#1a8fa0",
  "#a0681a",
  "#c43a3a",
  "#3d9970",
  "#9b59b6",
];

function playerColor(idx: number): string {
  return PLAYER_COLORS[idx % PLAYER_COLORS.length];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function fmtScore(v: number | null): string {
  if (v === null) return "—";
  if (v === 0) return "E";
  return v > 0 ? `+${v.toFixed(1)}` : `${v.toFixed(1)}`;
}

function scoreColor(s: number | null): string {
  if (s === null) return "#9ca8b6";
  if (s <= -4) return "#046c4e";
  if (s < 0) return "#2ca25f";
  if (s === 0) return "#8fb4e3";
  if (s < 4) return "#d08050";
  return "#a84534";
}

function rankMedal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `${rank}`;
}

// ---------------------------------------------------------------------------
// Section wrapper (matches analytics-tab.tsx style)
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

function Unavailable({ icon = "📊", message }: { icon?: string; message: string }) {
  return (
    <div className="analytics-unavailable">
      <span>{icon}</span>
      <span>{message}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. All-Time Standings Table
// ---------------------------------------------------------------------------

function AllTimeStandings({
  playerStats,
  currentUserId,
}: {
  playerStats: PlayerStats[];
  currentUserId: string | null;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--line)" }}>
            {[
              { label: "Rank", align: "center" },
              { label: "Player", align: "left" },
              { label: "Pools", align: "center" },
              { label: "Wins", align: "center" },
              { label: "Top 3", align: "center" },
              { label: "Avg Pos", align: "center" },
              { label: "Best", align: "center" },
              { label: "Worst", align: "center" },
              { label: "Style", align: "center" },
            ].map((h) => (
              <th
                key={h.label}
                style={{
                  padding: "6px 10px",
                  textAlign: h.align as "center" | "left",
                  fontWeight: 700,
                  fontSize: "0.7rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "var(--muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {playerStats.map((p, idx) => {
            const isMe = p.userId === currentUserId;
            const consistencyLabel =
              p.positionStdDev < 1.5
                ? { text: "Consistent", bg: "#2ca25f20", color: "#2ca25f" }
                : p.positionStdDev < 3
                  ? { text: "Variable", bg: "#e0762820", color: "#e07628" }
                  : { text: "Streaky", bg: "#c4287220", color: "#c42872" };

            return (
              <tr
                key={p.userId}
                style={{
                  borderBottom: "1px solid var(--line)",
                  background: isMe ? "var(--primary-soft)" : "transparent",
                }}
              >
                <td
                  style={{
                    padding: "10px",
                    textAlign: "center",
                    fontWeight: 800,
                    fontSize: "1rem",
                  }}
                >
                  {rankMedal(idx + 1)}
                </td>
                <td
                  style={{
                    padding: "10px",
                    fontWeight: isMe ? 800 : 600,
                    color: isMe ? "var(--primary)" : "var(--text)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.userName}
                  {isMe && (
                    <span
                      style={{
                        fontSize: "0.65rem",
                        marginLeft: 6,
                        color: "var(--primary)",
                        fontWeight: 600,
                        opacity: 0.8,
                      }}
                    >
                      you
                    </span>
                  )}
                </td>
                <td style={{ padding: "10px", textAlign: "center", color: "var(--muted)" }}>
                  {p.totalTournaments}
                </td>
                <td
                  style={{
                    padding: "10px",
                    textAlign: "center",
                    fontWeight: p.wins > 0 ? 800 : 400,
                    color: p.wins > 0 ? "#2ca25f" : "var(--muted)",
                  }}
                >
                  {p.wins}
                </td>
                <td style={{ padding: "10px", textAlign: "center", color: "var(--muted)" }}>
                  {p.top3}
                </td>
                <td style={{ padding: "10px", textAlign: "center", fontWeight: 700 }}>
                  {p.avgPosition.toFixed(1)}
                </td>
                <td
                  style={{
                    padding: "10px",
                    textAlign: "center",
                    color: "#2ca25f",
                    fontWeight: 700,
                  }}
                >
                  {ordinal(p.bestPosition)}
                </td>
                <td
                  style={{
                    padding: "10px",
                    textAlign: "center",
                    color: "#c42872",
                    fontWeight: 500,
                  }}
                >
                  {ordinal(p.worstPosition)}
                </td>
                <td style={{ padding: "10px", textAlign: "center" }}>
                  <span
                    style={{
                      fontSize: "0.72rem",
                      padding: "2px 8px",
                      borderRadius: 20,
                      background: consistencyLabel.bg,
                      color: consistencyLabel.color,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {consistencyLabel.text}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: 8 }}>
        Ranked by avg percentile finish — accounts for different field sizes across pools.
        Style = position std deviation (low = consistent, high = streaky).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Performance Trend — line chart of finish position over time
// ---------------------------------------------------------------------------

type TrendPoint = Record<string, string | number | null>;

function PerformanceTrend({
  playerStats,
  results,
  currentUserId,
}: {
  playerStats: PlayerStats[];
  results: TournamentResult[];
  currentUserId: string | null;
}) {
  const { chartData, maxPos } = useMemo(() => {
    const seen = new Set<string>();
    const uniquePools = results
      .filter((r) => !seen.has(r.poolId) && seen.add(r.poolId))
      .sort((a, b) => a.tournamentDate.localeCompare(b.tournamentDate));

    const maxPos = Math.max(...results.map((r) => r.totalEntrants), 2);

    const data: TrendPoint[] = uniquePools.map((pool) => {
      const point: TrendPoint = {
        label: pool.poolName.length > 16 ? pool.poolName.slice(0, 15) + "…" : pool.poolName,
        tournament: pool.tournamentName,
        poolId: pool.poolId,
      };
      for (const p of playerStats) {
        const r = results.find(
          (r) => r.poolId === pool.poolId && r.userId === p.userId,
        );
        point[p.userId] = r?.position ?? null;
      }
      return point;
    });

    return { chartData: data, maxPos };
  }, [results, playerStats]);

  const poolCount = new Set(results.map((r) => r.poolId)).size;

  if (poolCount < 2) {
    return <Unavailable icon="📈" message="Trend chart available after 2+ pools with data." />;
  }

  const yTicks = Array.from({ length: maxPos }, (_, i) => i + 1);

  return (
    <div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 40, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(21,32,43,0.07)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#667487" }}
              axisLine={false}
              tickLine={false}
              angle={-20}
              textAnchor="end"
              height={55}
              interval={0}
            />
            <YAxis
              reversed
              domain={[1, maxPos]}
              ticks={yTicks}
              tickFormatter={(v: number) => ordinal(v)}
              tick={{ fontSize: 11, fill: "#667487" }}
              axisLine={false}
              tickLine={false}
              width={38}
              allowDecimals={false}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const point = chartData.find((d) => d.label === label);
                const activePayload = payload.filter((p) => p.value !== null);
                return (
                  <div
                    style={{
                      background: "white",
                      border: "1px solid rgba(21,32,43,0.12)",
                      borderRadius: 10,
                      padding: "10px 14px",
                      fontSize: 12,
                      boxShadow: "0 4px 16px rgba(23,49,83,0.1)",
                      minWidth: 150,
                    }}
                  >
                    <p
                      style={{
                        fontWeight: 800,
                        marginBottom: 6,
                        fontSize: 13,
                        color: "#15202b",
                      }}
                    >
                      {(point?.tournament as string) ?? label}
                    </p>
                    {[...activePayload]
                      .sort((a, b) => (a.value as number) - (b.value as number))
                      .map((p) => {
                        const player = playerStats.find(
                          (ps) => ps.userId === (p.dataKey as string),
                        );
                        return (
                          <p
                            key={p.dataKey as string}
                            style={{ color: p.color, fontWeight: 600, marginBottom: 2 }}
                          >
                            {player?.userName}: {ordinal(p.value as number)}
                          </p>
                        );
                      })}
                  </div>
                );
              }}
            />
            {playerStats.map((p, idx) => (
              <Line
                key={p.userId}
                dataKey={p.userId}
                name={p.userName}
                stroke={playerColor(idx)}
                strokeWidth={p.userId === currentUserId ? 3 : 1.5}
                strokeDasharray={p.userId === currentUserId ? undefined : "6 3"}
                dot={{ r: 5, fill: playerColor(idx), strokeWidth: 0 }}
                activeDot={{ r: 7, strokeWidth: 2, stroke: "white" }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          marginTop: 4,
          justifyContent: "center",
        }}
      >
        {playerStats.map((p, idx) => (
          <span
            key={p.userId}
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem" }}
          >
            <span
              style={{
                width: 20,
                height: p.userId === currentUserId ? 3 : 2,
                borderRadius: 2,
                background: playerColor(idx),
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                color:
                  p.userId === currentUserId ? "var(--primary)" : "var(--text)",
                fontWeight: p.userId === currentUserId ? 700 : 400,
              }}
            >
              {p.userName}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Head-to-Head Matrix
// ---------------------------------------------------------------------------

function HeadToHeadMatrix({
  playerStats,
  h2h,
  currentUserId,
}: {
  playerStats: PlayerStats[];
  h2h: Map<string, Map<string, { wins: number; losses: number; ties: number }>>;
  currentUserId: string | null;
}) {
  const activePlayers = playerStats.filter((p) => h2h.has(p.userId));

  if (activePlayers.length < 2) {
    return (
      <Unavailable
        icon="🤝"
        message="Head-to-head records appear after 2+ players have competed in the same pool."
      />
    );
  }

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", minWidth: "max-content" }}>
          <thead>
            <tr>
              <th
                style={{
                  padding: "6px 12px 6px 0",
                  textAlign: "left",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  color: "var(--muted)",
                  minWidth: 100,
                  whiteSpace: "nowrap",
                }}
              >
                ↓ vs →
              </th>
              {activePlayers.map((p) => (
                <th
                  key={p.userId}
                  style={{
                    padding: "6px 14px",
                    textAlign: "center",
                    fontWeight: p.userId === currentUserId ? 800 : 600,
                    color:
                      p.userId === currentUserId ? "var(--primary)" : "var(--text)",
                    fontSize: "0.82rem",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.userName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activePlayers.map((row) => (
              <tr
                key={row.userId}
                style={{ borderTop: "1px solid var(--line)" }}
              >
                <td
                  style={{
                    padding: "10px 12px 10px 0",
                    fontWeight: row.userId === currentUserId ? 800 : 600,
                    color:
                      row.userId === currentUserId ? "var(--primary)" : "var(--text)",
                    whiteSpace: "nowrap",
                    background:
                      row.userId === currentUserId
                        ? "var(--primary-soft)"
                        : "transparent",
                  }}
                >
                  {row.userName}
                </td>
                {activePlayers.map((col) => {
                  if (row.userId === col.userId) {
                    return (
                      <td
                        key={col.userId}
                        style={{
                          padding: "10px 14px",
                          textAlign: "center",
                          color: "var(--muted)",
                          background: "rgba(21,32,43,0.04)",
                        }}
                      >
                        —
                      </td>
                    );
                  }
                  const record = h2h.get(row.userId)?.get(col.userId);
                  if (!record) {
                    return (
                      <td
                        key={col.userId}
                        style={{
                          padding: "10px 14px",
                          textAlign: "center",
                          color: "var(--muted)",
                          fontSize: "0.75rem",
                        }}
                      >
                        n/a
                      </td>
                    );
                  }
                  const isWinning = record.wins > record.losses;
                  const isLosing = record.losses > record.wins;
                  return (
                    <td
                      key={col.userId}
                      style={{
                        padding: "10px 14px",
                        textAlign: "center",
                        background: isWinning
                          ? "#2ca25f14"
                          : isLosing
                            ? "#c4287214"
                            : "transparent",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          color: isWinning
                            ? "#2ca25f"
                            : isLosing
                              ? "#c42872"
                              : "var(--muted)",
                        }}
                      >
                        {record.wins}–{record.losses}
                      </span>
                      {record.ties > 0 && (
                        <span
                          style={{
                            fontSize: "0.68rem",
                            color: "var(--muted)",
                            marginLeft: 3,
                          }}
                        >
                          ({record.ties}T)
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: 10 }}>
        Row player's win–loss record against the column player. Green cell = winning record,
        red = losing.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Golfer Heroes & Villains
// ---------------------------------------------------------------------------

function GolferCard({ g, accentColor }: { g: GolferImpactRow; accentColor: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 0",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: "0.87rem",
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {g.displayName}
        </div>
        <div style={{ fontSize: "0.71rem", color: "var(--muted)", marginTop: 2 }}>
          {g.timesSelected} pick{g.timesSelected !== 1 ? "s" : ""} ·{" "}
          {Math.round(g.cutRate * 100)}% cut rate
          {g.appearsOnWinners > 0 && (
            <span style={{ color: "#2ca25f", fontWeight: 600 }}>
              {" "}
              · {g.appearsOnWinners}W
            </span>
          )}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div
          style={{
            fontWeight: 800,
            fontSize: "0.9rem",
            color: scoreColor(g.avgScoreToPar),
          }}
        >
          {fmtScore(g.avgScoreToPar)}
        </div>
        <div style={{ fontSize: "0.68rem", color: "var(--muted)" }}>avg / cut</div>
      </div>
    </div>
  );
}

function GolferImpactSection({ impact }: { impact: GolferImpactRow[] }) {
  // Heroes: reliable makers with best avg scores
  const heroes = [...impact]
    .filter((g) => g.cutRate >= 0.5 && g.avgScoreToPar !== null)
    .sort((a, b) => (a.avgScoreToPar ?? 99) - (b.avgScoreToPar ?? 99))
    .slice(0, 7);

  // Villains: most missed cuts or worst scores when they do play
  const villains = [...impact]
    .sort((a, b) => {
      if (Math.abs(a.cutRate - b.cutRate) > 0.05) return a.cutRate - b.cutRate;
      return (b.avgScoreToPar ?? -99) - (a.avgScoreToPar ?? -99);
    })
    .slice(0, 7);

  if (heroes.length === 0 && villains.length === 0) {
    return (
      <Unavailable
        icon="🏌️"
        message="Golfer impact data appears after multiple pools with scoring."
      />
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 24,
      }}
    >
      <div>
        <p
          style={{
            fontSize: "0.72rem",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.09em",
            color: "#2ca25f",
            marginBottom: 10,
          }}
        >
          🏆 Heroes — Best when picked
        </p>
        {heroes.length > 0 ? (
          heroes.map((g) => (
            <GolferCard key={g.normalizedName} g={g} accentColor="#2ca25f" />
          ))
        ) : (
          <p style={{ fontSize: "0.82rem", color: "var(--muted)" }}>No data yet</p>
        )}
      </div>
      <div>
        <p
          style={{
            fontSize: "0.72rem",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.09em",
            color: "#c42872",
            marginBottom: 10,
          }}
        >
          💀 Villains — Drag teams down
        </p>
        {villains.length > 0 ? (
          villains.map((g) => (
            <GolferCard key={g.normalizedName} g={g} accentColor="#c42872" />
          ))
        ) : (
          <p style={{ fontSize: "0.82rem", color: "var(--muted)" }}>No data yet</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Win Share by Golfer — which golfers appear on winning teams most
// ---------------------------------------------------------------------------

function WinShareSection({ impact }: { impact: GolferImpactRow[] }) {
  const withWins = [...impact]
    .filter((g) => g.appearsOnWinners > 0)
    .sort((a, b) => b.appearsOnWinners - a.appearsOnWinners)
    .slice(0, 12);

  if (withWins.length === 0) {
    return (
      <Unavailable icon="🏆" message="Win share data appears after at least one pool has a winner." />
    );
  }

  const chartData = withWins.map((g) => ({
    name: g.displayName.split(" ").slice(-1)[0],
    fullName: g.displayName,
    wins: g.appearsOnWinners,
    total: g.timesSelected,
    winRate: Math.round(g.winRate * 100),
    fill: scoreColor(g.avgScoreToPar),
  }));

  return (
    <div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 16, bottom: 24, left: 0 }}
            barSize={32}
          >
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fontWeight: 600, fill: "#15202b" }}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "#667487" }}
              axisLine={false}
              tickLine={false}
              width={24}
            />
            <Tooltip
              cursor={{ fill: "rgba(21,32,43,0.04)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as (typeof chartData)[0];
                return (
                  <div
                    style={{
                      background: "white",
                      border: "1px solid rgba(21,32,43,0.12)",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 12,
                      boxShadow: "0 4px 16px rgba(23,49,83,0.1)",
                    }}
                  >
                    <p style={{ fontWeight: 800, marginBottom: 4, fontSize: 13 }}>
                      {d.fullName}
                    </p>
                    <p style={{ color: "#667487" }}>
                      On winning team {d.wins} time{d.wins !== 1 ? "s" : ""}
                    </p>
                    <p style={{ color: "#667487" }}>
                      Win rate: {d.winRate}% ({d.wins}/{d.total} picks)
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="wins" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="wins"
                position="top"
                style={{ fontSize: 11, fontWeight: 700, fill: "#667487" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: 4 }}>
        Bar color = avg score-to-par when picked. Counts how many times a golfer appeared on
        a 1st-place team.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Pick Strategy: Contrarian vs Chalk
// ---------------------------------------------------------------------------

function ContrarianSection({
  contrarianStats,
  currentUserId,
}: {
  contrarianStats: ContrarianRow[];
  currentUserId: string | null;
}) {
  if (contrarianStats.length === 0) {
    return (
      <Unavailable
        icon="🎯"
        message="Pick analysis available after multiple players submit picks in the same pool."
      />
    );
  }

  const sorted = [...contrarianStats].sort((a, b) => b.uniquePickRate - a.uniquePickRate);

  const chartData = sorted.map((s) => ({
    userId: s.userId,
    name: s.userName.length > 13 ? s.userName.slice(0, 12) + "…" : s.userName,
    fullName: s.userName,
    pct: Math.round(s.uniquePickRate * 100),
    uniquePicks: s.uniquePicks,
    totalPicks: s.totalPicks,
    fill: s.userId === currentUserId ? "#1c6ee7" : "#8fb4e3",
  }));

  return (
    <div>
      <p
        style={{
          fontSize: "0.82rem",
          color: "var(--muted)",
          marginBottom: 14,
          lineHeight: 1.5,
        }}
      >
        A "unique pick" is a golfer no one else chose in that pool for that tier slot. 100% =
        always contrarian, 0% = always picks the same as someone else.
      </p>
      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 16, bottom: 10, left: 0 }}
            barSize={36}
          >
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fontWeight: 600, fill: "#15202b" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 11, fill: "#667487" }}
              axisLine={false}
              tickLine={false}
              domain={[0, 100]}
              width={36}
            />
            <ReferenceLine
              y={50}
              stroke="rgba(21,32,43,0.15)"
              strokeDasharray="4 3"
            />
            <Tooltip
              cursor={{ fill: "rgba(21,32,43,0.04)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as (typeof chartData)[0];
                return (
                  <div
                    style={{
                      background: "white",
                      border: "1px solid rgba(21,32,43,0.12)",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 12,
                      boxShadow: "0 4px 16px rgba(23,49,83,0.1)",
                    }}
                  >
                    <p style={{ fontWeight: 800, marginBottom: 4, fontSize: 13 }}>
                      {d.fullName}
                    </p>
                    <p style={{ color: "#667487" }}>{d.pct}% unique picks</p>
                    <p style={{ color: "#667487" }}>
                      {d.uniquePicks} of {d.totalPicks} total tier picks were unique
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="pct" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="pct"
                position="top"
                formatter={(v: unknown) => `${v}%`}
                style={{ fontSize: 11, fontWeight: 700, fill: "#667487" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          fontSize: "0.7rem",
          color: "var(--muted)",
        }}
      >
        <span>← Chalk (always picks with the crowd)</span>
        <span>Contrarian (blazes own trail) →</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Fun stats — summary callout cards
// ---------------------------------------------------------------------------

function StatCallout({
  label,
  value,
  sub,
  color = "var(--primary)",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        boxShadow: "0 1px 4px rgba(23,49,83,0.06)",
      }}
    >
      <p
        style={{
          fontSize: "0.68rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.09em",
          color: "var(--muted)",
        }}
      >
        {label}
      </p>
      <p style={{ fontWeight: 900, fontSize: "1.5rem", color, lineHeight: 1.1 }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{sub}</p>}
    </div>
  );
}

function SummaryCallouts({
  playerStats,
  results,
  currentUserId,
}: {
  playerStats: PlayerStats[];
  results: TournamentResult[];
  currentUserId: string | null;
}) {
  const totalPools = new Set(results.map((r) => r.poolId)).size;
  const totalPlayers = playerStats.length;

  const leader = playerStats[0];
  const myStats = playerStats.find((p) => p.userId === currentUserId);

  const mostConsistent = [...playerStats]
    .filter((p) => p.totalTournaments >= 2)
    .sort((a, b) => a.positionStdDev - b.positionStdDev)[0];

  const biggestWinner = playerStats.find((p) => p.wins > 0);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 12,
      }}
    >
      <StatCallout
        label="Total Pools"
        value={`${totalPools}`}
        sub={`${totalPlayers} players tracked`}
        color="var(--primary)"
      />
      {biggestWinner && (
        <StatCallout
          label="Most Wins"
          value={`${biggestWinner.userName}`}
          sub={`${biggestWinner.wins} win${biggestWinner.wins !== 1 ? "s" : ""} (${Math.round(biggestWinner.winRate * 100)}% win rate)`}
          color="#2ca25f"
        />
      )}
      {mostConsistent && (
        <StatCallout
          label="Most Consistent"
          value={mostConsistent.userName}
          sub={`Avg pos ${mostConsistent.avgPosition.toFixed(1)} · std dev ${mostConsistent.positionStdDev.toFixed(1)}`}
          color="#7b2fb5"
        />
      )}
      {myStats && (
        <StatCallout
          label="Your Record"
          value={`${myStats.wins}W / ${myStats.totalTournaments - myStats.wins}L`}
          sub={`Avg ${ordinal(Math.round(myStats.avgPosition))} · best ${ordinal(myStats.bestPosition)}`}
          color="#1c6ee7"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function GlobalAnalytics() {
  const router = useRouter();
  const { state, currentUser, isReady, hasSession } = useAppState();

  useEffect(() => {
    if (isReady && !hasSession) router.replace("/");
  }, [isReady, hasSession, router]);

  const results = useMemo(() => buildGlobalResults(state), [state]);
  const playerStats = useMemo(() => buildPlayerStats(results), [results]);
  const golferImpact = useMemo(() => buildGolferImpact(results), [results]);
  const h2h = useMemo(() => buildHeadToHead(results), [results]);
  const contrarianStats = useMemo(
    () => buildContrarianStats(results, state),
    [results, state],
  );

  if (!isReady || !currentUser) return null;

  const totalPools = new Set(results.map((r) => r.poolId)).size;

  if (results.length === 0) {
    return (
      <main className="dashboard-shell">
        <section className="home-hero">
          <div>
            <p className="eyebrow">Global Analytics</p>
            <h1>All-Time Stats</h1>
          </div>
          <Link
            className="secondary-button small-button"
            href="/"
            style={{ flexShrink: 0 }}
          >
            ← Dashboard
          </Link>
        </section>
        <div className="empty-state" style={{ margin: "40px auto" }}>
          <span className="empty-state-icon">📊</span>
          <p style={{ fontWeight: 700 }}>No analytics yet</p>
          <p className="muted small">
            Analytics appear once you&apos;ve participated in at least one locked pool with
            submitted picks.
          </p>
          <Link className="primary-button small-button" href="/">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      {/* Hero */}
      <section className="home-hero">
        <div>
          <p className="eyebrow">Global Analytics</p>
          <h1>All-Time Stats</h1>
          <p className="muted">
            {totalPools} pool{totalPools !== 1 ? "s" : ""} · {playerStats.length} player
            {playerStats.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link className="secondary-button small-button" href="/" style={{ flexShrink: 0 }}>
          ← Dashboard
        </Link>
      </section>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 48 }}>
        {/* Summary callouts */}
        <SummaryCallouts
          playerStats={playerStats}
          results={results}
          currentUserId={currentUser.id}
        />

        <Section
          title="All-Time Rankings"
          subtitle="Overall standings across every pool. Ranked by average percentile finish to fairly compare pools of different sizes."
        >
          <AllTimeStandings
            playerStats={playerStats}
            currentUserId={currentUser.id}
          />
        </Section>

        <Section
          title="Performance Trend"
          subtitle="Finishing position in each pool over time — lower is better. Your line is solid; others are dashed."
        >
          <PerformanceTrend
            playerStats={playerStats}
            results={results}
            currentUserId={currentUser.id}
          />
        </Section>

        <Section
          title="Head-to-Head Records"
          subtitle="Win–loss record when two players competed in the same pool. Read each row against the column player."
        >
          <HeadToHeadMatrix
            playerStats={playerStats}
            h2h={h2h}
            currentUserId={currentUser.id}
          />
        </Section>

        <Section
          title="Golfer Heroes & Villains"
          subtitle="Which golfers help or hurt across all pools. Heroes: best avg score + reliable cut-maker. Villains: most missed cuts or worst scores."
        >
          <GolferImpactSection impact={golferImpact} />
        </Section>

        <Section
          title="Win Share by Golfer"
          subtitle="Golfers who appear most often on 1st-place teams. Bar color = their avg score-to-par when picked."
        >
          <WinShareSection impact={golferImpact} />
        </Section>

        <Section
          title="Pick Strategy: Contrarian vs Chalk"
          subtitle="How often each player picks a golfer no one else in their pool chose for that tier. Higher % = more contrarian, lower = more chalk."
        >
          <ContrarianSection
            contrarianStats={contrarianStats}
            currentUserId={currentUser.id}
          />
        </Section>
      </div>
    </main>
  );
}
