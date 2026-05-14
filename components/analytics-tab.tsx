"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  Cell,
  LabelList,
} from "recharts";
import { computeOwnershipStats, type OwnershipPoint } from "@/lib/analytics";
import type { DKOddsGolfer } from "@/app/api/draftkings-odds/route";
import type { Golfer, LeaderboardRow, Pool, PoolEntry, Tournament, User } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreStr(score: number | null, eliminated?: boolean): string {
  if (eliminated) return "Out";
  if (score === null || score === 0) return "E";
  return score > 0 ? `+${score}` : `${score}`;
}

function pctStr(p: number | null): string {
  if (p === null) return "—";
  return `${(p * 100).toFixed(1)}%`;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreColor(score: number | null, madeCut = true): string {
  if (!madeCut) return "#9ca8b6";
  if (score === null) return "#8fb4e3";
  if (score <= -8) return "#046c4e";
  if (score <= -4) return "#0f8f5f";
  if (score < 0) return "#4aaa80";
  if (score === 0) return "#8fb4e3";
  if (score < 4) return "#d08050";
  if (score < 8) return "#a84534";
  return "#7a2020";
}

function teamScoreColor(score: number | null, status: string): string {
  if (status === "eliminated") return "#9ca8b6";
  return scoreColor(score, true);
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
// 1. Field Spread — horizontal bar chart of all team scores
// ---------------------------------------------------------------------------

function FieldSpreadChart({ leaderboard }: { leaderboard: LeaderboardRow[] }) {
  const sorted = useMemo(
    () =>
      [...leaderboard]
        .filter((r) => r.teamScore !== null)
        .sort((a, b) => (a.teamScore ?? 0) - (b.teamScore ?? 0))
        .map((r) => ({
          name: r.teamName.length > 20 ? r.teamName.slice(0, 19) + "…" : r.teamName,
          score: r.teamScore ?? 0,
          status: r.status,
          fill: teamScoreColor(r.teamScore, r.status),
        })),
    [leaderboard],
  );

  if (sorted.length === 0) {
    return <Unavailable message="Scores not available yet — check back once the tournament starts." />;
  }

  const scores = sorted.map((d) => d.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const domainMin = Math.min(minScore - 1, -1);
  const domainMax = Math.max(maxScore + 1, 1);
  const spread = maxScore - minScore;

  const barH = 38;
  const chartHeight = sorted.length * barH + 56;

  return (
    <div>
      {/* Spread summary pill */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", color: "#667487" }}>
          Leader:{" "}
          <strong style={{ color: scoreColor(minScore) }}>{scoreStr(minScore)}</strong>
        </span>
        <span style={{ fontSize: "0.8rem", color: "#667487" }}>
          Last:{" "}
          <strong style={{ color: scoreColor(maxScore) }}>{scoreStr(maxScore)}</strong>
        </span>
        <span style={{ fontSize: "0.8rem", color: "#667487" }}>
          Spread: <strong>{spread} stroke{spread !== 1 ? "s" : ""}</strong>
        </span>
      </div>

      <div style={{ width: "100%", height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={sorted}
            margin={{ top: 2, right: 52, bottom: 2, left: 4 }}
            barSize={22}
          >
            <XAxis
              type="number"
              domain={[domainMin, domainMax]}
              tickFormatter={(v: number) => (v === 0 ? "E" : v > 0 ? `+${v}` : `${v}`)}
              tick={{ fontSize: 11, fill: "#667487" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={130}
              tick={{ fontSize: 12, fontWeight: 600, fill: "#15202b" }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine x={0} stroke="rgba(21,32,43,0.2)" strokeWidth={1.5} />
            <Bar dataKey="score" radius={4} isAnimationActive={false}>
              {sorted.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="score"
                position="right"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => (v === 0 ? "E" : v > 0 ? `+${v}` : `${v}`)}
                style={{ fontSize: 12, fontWeight: 800, fill: "#15202b" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Picks by Tier — card grid showing each tier's picks across the field
// ---------------------------------------------------------------------------

function PicksByTier({
  leaderboard,
  pool,
  entries,
  golferMap,
  users,
}: {
  leaderboard: LeaderboardRow[];
  pool: Pool;
  entries: PoolEntry[];
  golferMap: Map<string, Golfer>;
  users: User[];
}) {
  const submitted = entries.filter((e) => e.poolId === pool.id && e.submittedAt !== null);
  if (submitted.length === 0) return <Unavailable icon="⛳" message="No submitted picks yet." />;

  const userMap = new Map(users.map((u) => [u.id, u]));

  const tierData = pool.tiers.map((tier, idx) => {
    const golferPicks = new Map<string, { golfer: Golfer | undefined; teams: string[] }>();

    for (const entry of submitted) {
      const sel = entry.selections.find((s) => s.tierId === tier.id);
      if (!sel) continue;
      const teamName =
        leaderboard.find((r) => r.userId === entry.userId)?.teamName ??
        userMap.get(entry.userId)?.userName ??
        "Unknown";
      const rec = golferPicks.get(sel.golferId) ?? {
        golfer: golferMap.get(sel.golferId),
        teams: [],
      };
      rec.teams.push(teamName);
      golferPicks.set(sel.golferId, rec);
    }

    const sorted = [...golferPicks.values()].sort((a, b) => {
      const aOut = !a.golfer?.madeCut;
      const bOut = !b.golfer?.madeCut;
      if (aOut && !bOut) return 1;
      if (!aOut && bOut) return -1;
      return (a.golfer?.currentScoreToPar ?? 999) - (b.golfer?.currentScoreToPar ?? 999);
    });

    return { tier, idx, picks: sorted };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {tierData.map(({ tier, idx, picks }) => (
        <div key={tier.id}>
          <p
            style={{
              fontSize: "0.72rem",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.09em",
              color: "var(--muted)",
              marginBottom: 10,
            }}
          >
            Tier {idx + 1}{tier.label ? ` · ${tier.label}` : ""}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {picks.map(({ golfer, teams }) => {
              const score = golfer?.currentScoreToPar ?? null;
              const madeCut = golfer?.madeCut ?? true;
              const color = scoreColor(score, madeCut);
              const isUnique = teams.length === 1;
              const isSplit = picks.length > 1;

              return (
                <div
                  key={golfer?.id ?? teams.join()}
                  style={{
                    background: color + "18",
                    border: `1.5px solid ${color}50`,
                    borderRadius: 14,
                    padding: "10px 14px",
                    minWidth: 150,
                    flex: "1 1 150px",
                    maxWidth: 240,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "0.88rem",
                        color: "#15202b",
                        lineHeight: 1.25,
                      }}
                    >
                      {golfer?.name ?? "Unknown"}
                    </span>
                    {isSplit && (
                      <span
                        style={{
                          fontSize: "0.65rem",
                          fontWeight: 800,
                          background: color + "30",
                          color: color,
                          borderRadius: 20,
                          padding: "2px 7px",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {teams.length} / {submitted.length}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: "0.85rem", color }}>
                      {!madeCut ? (golfer?.position ?? "MC") : scoreStr(score)}
                    </span>
                    {golfer?.position && madeCut && (
                      <span style={{ fontSize: "0.75rem", color: "#667487" }}>
                        {golfer.position}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#667487", lineHeight: 1.4 }}>
                    {isUnique ? (
                      <span style={{ fontStyle: "italic" }}>only {teams[0]}</span>
                    ) : (
                      teams.join(", ")
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Golfer Ownership Bar Chart
// ---------------------------------------------------------------------------

function OwnershipBarChart({ data }: { data: OwnershipPoint[] }) {
  if (data.length === 0) {
    return <Unavailable icon="⛳" message="No submitted picks yet." />;
  }

  const chartData = data.slice(0, 14).map((d) => ({
    label: d.name.split(" ").slice(-1)[0],
    fullName: d.name,
    count: d.ownership,
    pct: Math.round(d.ownershipPct * 100),
    score: d.scoreToPar,
    madeCut: d.madeCut,
    position: d.position,
    fill: scoreColor(d.scoreToPar, d.madeCut),
  }));

  return (
    <div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
        {[
          { color: "#046c4e", label: "−8 or better" },
          { color: "#0f8f5f", label: "−4 to −7" },
          { color: "#4aaa80", label: "Under par" },
          { color: "#8fb4e3", label: "Even" },
          { color: "#d08050", label: "Over par" },
          { color: "#9ca8b6", label: "Missed cut" },
        ].map(({ color, label }) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.72rem", color: "#667487" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: "inline-block", flexShrink: 0 }} />
            {label}
          </span>
        ))}
      </div>

      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 16, bottom: 24, left: 0 }}
            barSize={32}
          >
            <XAxis
              dataKey="label"
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
              width={28}
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
                    <p style={{ fontWeight: 800, marginBottom: 4, fontSize: 13 }}>{d.fullName}</p>
                    <p style={{ color: "#667487", marginBottom: 2 }}>
                      {d.count} team{d.count !== 1 ? "s" : ""} ({d.pct}%)
                    </p>
                    <p style={{ color: d.fill, fontWeight: 700 }}>
                      {d.madeCut ? scoreStr(d.score) : d.position} · {d.position}
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="pct"
                position="top"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => `${v}%`}
                style={{ fontSize: 10, fontWeight: 700, fill: "#667487" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Win Probability Bar Chart (DK or DataGolf)
// ---------------------------------------------------------------------------

type ProbKey = "cut" | "top10" | "top5" | "win";

type OddsEntry = { name: string; cut: number | null; top5: number | null; top10: number | null; win: number | null };

function lookupByName(name: string, map: Map<string, OddsEntry>): OddsEntry | undefined {
  const norm = normalizeName(name);
  if (map.has(norm)) return map.get(norm);
  const last = norm.split(" ").at(-1) ?? "";
  for (const [key, val] of map) {
    if (key.endsWith(` ${last}`) || key === last) return val;
  }
}

function teamAvgProb(
  golfers: Golfer[],
  map: Map<string, OddsEntry>,
  key: ProbKey,
): number | null {
  const vals: number[] = [];
  for (const g of golfers) {
    const entry = lookupByName(g.name, map);
    const v = entry?.[key];
    if (v != null) vals.push(v);
  }
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

const PROB_TABS: { key: ProbKey; label: string }[] = [
  { key: "cut", label: "Make Cut" },
  { key: "top10", label: "Top 10" },
  { key: "top5", label: "Top 5" },
  { key: "win", label: "Win" },
];

function WinProbChart({
  leaderboard,
  oddsMap,
  activeKey,
  onKeyChange,
  loading,
  unavailableMsg,
}: {
  leaderboard: LeaderboardRow[];
  oddsMap: Map<string, OddsEntry> | null;
  activeKey: ProbKey;
  onKeyChange: (k: ProbKey) => void;
  loading: boolean;
  unavailableMsg: string;
}) {
  if (loading) {
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
        <span>Loading…</span>
      </div>
    );
  }

  if (!oddsMap) {
    return <Unavailable icon="🔌" message={unavailableMsg} />;
  }

  const active = leaderboard.filter((r) => r.status !== "eliminated");

  const chartData = [...active]
    .map((r) => {
      const all = [...r.countingGolfers, ...r.benchGolfers];
      return {
        name: r.teamName.length > 16 ? r.teamName.slice(0, 15) + "…" : r.teamName,
        value: teamAvgProb(all, oddsMap, activeKey),
        score: r.teamScore,
        status: r.status,
      };
    })
    .filter((d) => d.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .map((d) => ({ ...d, fill: teamScoreColor(d.score, d.status) }));

  if (chartData.length === 0) {
    return <Unavailable message="No probability data available for current teams." />;
  }

  const barH = 36;
  const chartHeight = chartData.length * barH + 56;

  return (
    <div>
      {/* Tab toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {PROB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onKeyChange(tab.key)}
            style={{
              padding: "4px 12px",
              borderRadius: 20,
              border: "1px solid",
              fontSize: "0.78rem",
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s",
              borderColor: activeKey === tab.key ? "var(--primary)" : "var(--line)",
              background: activeKey === tab.key ? "var(--primary-soft)" : "transparent",
              color: activeKey === tab.key ? "var(--primary)" : "var(--muted)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ width: "100%", height: chartHeight }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 2, right: 56, bottom: 2, left: 4 }}
            barSize={22}
          >
            <XAxis
              type="number"
              domain={[0, 1]}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              tick={{ fontSize: 11, fill: "#667487" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={130}
              tick={{ fontSize: 12, fontWeight: 600, fill: "#15202b" }}
              axisLine={false}
              tickLine={false}
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
                    <p style={{ fontWeight: 800, marginBottom: 4, fontSize: 13 }}>{d.name}</p>
                    <p style={{ color: "#667487" }}>
                      Avg {PROB_TABS.find((t) => t.key === activeKey)?.label} prob:{" "}
                      <strong>{pctStr(d.value)}</strong>
                    </p>
                    <p style={{ color: d.fill, fontWeight: 700, marginTop: 2 }}>
                      {scoreStr(d.score)}
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="value" radius={4} isAnimationActive={false}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => `${Math.round(v * 100)}%`}
                style={{ fontSize: 12, fontWeight: 800, fill: "#15202b" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p style={{ fontSize: "0.72rem", color: "#9ca8b6", marginTop: 8 }}>
        Bar color = current team score. Probability = avg across all team's golfers.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

type DGGolfer = { name: string; cut: number; top10: number; top5: number; win: number };

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
  const [dkRaw, setDkRaw] = useState<DKOddsGolfer[] | null | undefined>(undefined);
  const [dgRaw, setDgRaw] = useState<DGGolfer[] | null | undefined>(undefined);
  const [dkKey, setDkKey] = useState<ProbKey>("win");
  const [dgKey, setDgKey] = useState<ProbKey>("win");

  const leagueId = tournament.importMeta?.leagueId;

  useEffect(() => {
    if (!leagueId) { setDkRaw(null); return; }
    fetch(`/api/draftkings-odds?leagueId=${leagueId}`)
      .then((r) => r.json())
      .then((body: { golfers: DKOddsGolfer[] | null }) => setDkRaw(body.golfers ?? null))
      .catch(() => setDkRaw(null));
  }, [leagueId]);

  useEffect(() => {
    fetch("/api/datagolf")
      .then((r) => r.json())
      .then((body: { golfers: DGGolfer[] | null }) => setDgRaw(body.golfers ?? null))
      .catch(() => setDgRaw(null));
  }, []);

  const dkMap = useMemo((): Map<string, OddsEntry> | null => {
    if (!dkRaw) return null;
    return new Map(
      dkRaw.map((g) => [
        normalizeName(g.name),
        { name: g.name, cut: g.cut ?? null, top5: g.top5 ?? null, top10: g.top10 ?? null, win: g.win ?? null },
      ]),
    );
  }, [dkRaw]);

  const dgMap = useMemo((): Map<string, OddsEntry> | null => {
    if (!dgRaw) return null;
    return new Map(
      dgRaw.map((g) => [
        normalizeName(g.name),
        { name: g.name, cut: g.cut, top5: g.top5, top10: g.top10, win: g.win },
      ]),
    );
  }, [dgRaw]);

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
        <p className="muted small">Analytics appear once members submit their picks.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <Section
        title="Field Standings"
        subtitle="Current score for each team, sorted best to worst. Shows how spread out the field is."
      >
        <FieldSpreadChart leaderboard={leaderboard} />
      </Section>

      <Section
        title="Picks by Tier"
        subtitle="Every golfer picked in each tier slot, sorted by current score. See where separation is coming from."
      >
        <PicksByTier
          leaderboard={leaderboard}
          pool={pool}
          entries={entries}
          golferMap={golferMap}
          users={users}
        />
      </Section>

      <Section
        title="Golfer Ownership"
        subtitle="How many teams picked each golfer — bar color shows current performance."
      >
        <OwnershipBarChart data={ownershipData} />
      </Section>

      <Section
        title="DraftKings Odds"
        subtitle="Average implied probability per team based on their golfers' DraftKings odds."
      >
        <WinProbChart
          leaderboard={leaderboard}
          oddsMap={dkMap}
          activeKey={dkKey}
          onKeyChange={setDkKey}
          loading={dkRaw === undefined}
          unavailableMsg="DraftKings odds are only available for DraftKings-imported tournaments with an active market."
        />
      </Section>

      <Section
        title="DataGolf Model"
        subtitle="Average implied probability per team based on DataGolf's predictive model."
      >
        <WinProbChart
          leaderboard={leaderboard}
          oddsMap={dgMap}
          activeKey={dgKey}
          onKeyChange={setDgKey}
          loading={dgRaw === undefined}
          unavailableMsg="DataGolf live model is only available during active tournament rounds."
        />
      </Section>
    </div>
  );
}
