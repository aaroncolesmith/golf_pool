"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DraftBoard } from "@/components/draft-board";
import { isPoolLocked, poolSharePath, validateSelections } from "@/lib/pool";
import { buildLeaderboard } from "@/lib/scoring";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAppState } from "@/lib/store";
import { Golfer, Pool, TeamSelection } from "@/lib/types";
import { AnalyticsTab } from "@/components/analytics-tab";
import { formatDate } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreLabel(score: number): string {
  if (score === 0) return "E";
  return score > 0 ? `+${score}` : `${score}`;
}

function scoreBadgeClass(score: number): string {
  if (score === 0) return "score-badge even";
  return score < 0 ? "score-badge under" : "score-badge over";
}

function formatLastSynced(isoString: string | null): string {
  if (!isoString) return "Not yet synced";
  const d = new Date(isoString);
  return `Updated ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

type TabId = "picks" | "leaderboard" | "analytics" | "members" | "admin";

// ---------------------------------------------------------------------------
// Tab: My Picks
// ---------------------------------------------------------------------------

function PicksTab({
  pool,
  golferMap,
  isLocked,
  isMember,
  existingEntry,
  currentUser,
}: {
  pool: Pool;
  golferMap: Map<string, Golfer>;
  isLocked: boolean;
  isMember: boolean;
  existingEntry: { selections: TeamSelection[]; submittedAt: string | null } | null | undefined;
  currentUser: { id: string; userName: string } | null;
}) {
  const { saveEntry } = useAppState();
  const [selections, setSelections] = useState<TeamSelection[]>(
    existingEntry?.selections ?? [],
  );
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  // Prevent server data from overwriting local state once the user starts editing
  const userIsEditingRef = useRef(false);

  useEffect(() => {
    if (userIsEditingRef.current) return;
    setSelections(existingEntry?.selections ?? []);
  }, [existingEntry]);

  const validation = validateSelections(pool, selections);

  // Auto-save on every change. Submit when all picks are complete.
  useEffect(() => {
    if (selections.length === 0 || isLocked) return;
    const isComplete = validation.isValid;
    const timer = setTimeout(() => {
      saveEntry(pool.id, selections, isComplete).then((entry) => {
        if (entry && isComplete) {
          setDraftMessage("All picks saved ✓");
        }
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [selections, pool.id, isLocked, saveEntry, validation.isValid]);

  function updateSelection(tierId: string, golferId: string) {
    userIsEditingRef.current = true;
    setDraftMessage(null);
    setSelections((prev) => {
      const withoutTier = prev.filter((s) => s.tierId !== tierId);
      return [...withoutTier, { tierId, golferId }];
    });
  }

  if (!currentUser) {
    return (
      <div className="notice notice-error">
        <p>Sign in to make your picks.</p>
      </div>
    );
  }

  if (!isMember) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🔒</span>
        <p style={{ fontWeight: 700 }}>You&apos;re not in this pool</p>
        <p className="muted small">
          Join using a valid invite link or the join code on your dashboard.
        </p>
      </div>
    );
  }

  return (
    <DraftBoard
      pool={pool}
      golferMap={golferMap}
      selections={selections}
      onSelectionChange={updateSelection}
      draftMessage={draftMessage}
      existingSubmittedAt={existingEntry?.submittedAt ?? null}
      isLocked={isLocked}
      isValid={validation.isValid}
    />
  );
}

// ---------------------------------------------------------------------------
// Scoreboard — Augusta-style flat board
// ---------------------------------------------------------------------------

function sbScoreStr(score: number | null): string {
  if (score === null || score === 0) return "E";
  return score > 0 ? `+${score}` : `${score}`;
}

function sbScoreClass(score: number | null, status?: string): string {
  if (status === "eliminated") return "sb-cut";
  if (score === null || score === 0) return "sb-even";
  return score < 0 ? "sb-under" : "sb-over";
}

function lastNameOf(fullName: string): string {
  const parts = fullName.trim().split(" ");
  return parts[parts.length - 1].toUpperCase();
}

function Scoreboard({
  leaderboard,
  currentUserId,
  isLocked,
}: {
  leaderboard: ReturnType<typeof buildLeaderboard>;
  currentUserId: string | null;
  isLocked: boolean;
}) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  function toggleRow(entryId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(entryId) ? next.delete(entryId) : next.add(entryId);
      return next;
    });
  }

  const activeRows = leaderboard.filter((r) => r.status !== "eliminated");
  const eliminatedRows = leaderboard.filter((r) => r.status === "eliminated");

  function rankOf(row: ReturnType<typeof buildLeaderboard>[number]): string {
    const myScore = row.teamScore ?? 999;
    const betterCount = activeRows.filter((r) => (r.teamScore ?? 999) < myScore).length;
    const rank = betterCount + 1;
    const tied = activeRows.filter((r) => (r.teamScore ?? 999) === myScore).length > 1;
    return tied ? `T${rank}` : `${rank}`;
  }

  function renderRow(row: ReturnType<typeof buildLeaderboard>[number], isElim: boolean) {
    const isExpanded = expandedRows.has(row.entryId);
    const isYou = row.userId === currentUserId;
    const canSeePicks = isLocked || isYou;

    return (
      <div key={row.entryId} className={`sb-row-wrap${isElim ? " sb-row-wrap--elim" : ""}`}>
        <button className="sb-row" onClick={() => toggleRow(row.entryId)} type="button">
          {/* Position */}
          <span className="sb-col-pos sb-rank">
            {isElim ? "—" : rankOf(row)}
          </span>

          {/* Team name */}
          <span className="sb-col-team sb-team-name">
            {row.teamName}
            {isYou && <span className="sb-you">★</span>}
          </span>

          {/* Total score */}
          <span className={`sb-col-tot sb-tot ${sbScoreClass(row.teamScore, row.status)}`}>
            {isElim ? "OUT" : sbScoreStr(row.teamScore)}
          </span>

          {/* Counting golfer chips */}
          <div className="sb-col-golfers sb-chips">
            {canSeePicks ? (
              row.countingGolfers.map((g) => (
                <div className="sb-chip" key={g.id}>
                  <span className="sb-chip-name">{lastNameOf(g.name)}</span>
                  <span className={`sb-chip-score ${sbScoreClass(g.currentScoreToPar)}`}>
                    {sbScoreStr(g.currentScoreToPar)}
                  </span>
                </div>
              ))
            ) : (
              <span style={{ fontSize: "0.78rem", color: "#9ca8b6", fontStyle: "italic" }}>
                Revealed at lock
              </span>
            )}
          </div>
        </button>

        {/* Bench sub-row (expandable) */}
        {isExpanded && canSeePicks && row.benchGolfers.length > 0 && (
          <div className="sb-bench">
            <span className="sb-bench-label">bench</span>
            {row.benchGolfers.map((g) => (
              <span
                key={g.id}
                className={`sb-bench-golfer${!g.madeCut ? " sb-bench-golfer--cut" : ""}`}
              >
                <span className="sb-bench-name">{lastNameOf(g.name)}</span>
                <span className="sb-bench-score">
                  {g.madeCut ? sbScoreStr(g.currentScoreToPar) : "CUT"}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="sb">
      {/* Arch banner */}
      <div className="sb-banner">
        <span className="sb-banner-title">LEADERS</span>
      </div>

      {/* Column headers */}
      <div className="sb-col-header">
        <span className="sb-col-pos">POS</span>
        <span>TEAM</span>
        <span className="sb-col-tot">TOT</span>
        <span className="sb-col-golfers">COUNTING GOLFERS</span>
      </div>

      {/* Active teams */}
      {activeRows.map((row) => renderRow(row, false))}

      {/* Eliminated separator + rows */}
      {eliminatedRows.length > 0 && (
        <>
          <div className="sb-elim-divider">
            <span className="sb-elim-divider-line" />
            <span className="sb-elim-divider-label">Eliminated</span>
            <span className="sb-elim-divider-line" />
          </div>
          {eliminatedRows.map((row) => renderRow(row, true))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Leaderboard
// ---------------------------------------------------------------------------

function LeaderboardTab({
  leaderboard,
  isLocked,
  isMember,
  currentUserId,
  tournamentId,
  scoresLastSyncedAt,
  onScoresSynced,
}: {
  leaderboard: ReturnType<typeof buildLeaderboard>;
  isLocked: boolean;
  isMember: boolean;
  currentUserId: string | null;
  tournamentId: string;
  scoresLastSyncedAt: string | null;
  onScoresSynced: (ts: string) => void;
}) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const { refreshGolfers } = useAppState();

  async function handleSyncScores() {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/scores/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentId }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        eventName?: string;
        updated?: number;
        unmatched?: string[];
        error?: string;
      };
      if (data.ok) {
        setSyncMessage(`Synced ${data.updated ?? 0} scores from "${data.eventName}".`);
        await refreshGolfers(tournamentId);
        onScoresSynced(new Date().toISOString());
      } else {
        setSyncMessage(`Sync failed: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      setSyncMessage("Sync failed — check your connection.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Sync controls */}
      {isMember && isLocked && (
        <div className="sync-controls" style={{ marginBottom: 16 }}>
          <button
            className="secondary-button small-button"
            onClick={handleSyncScores}
            disabled={isSyncing}
            type="button"
          >
            {isSyncing ? "Syncing…" : "↻ Sync Scores"}
          </button>
          {scoresLastSyncedAt && (
            <span className="sync-timestamp">{formatLastSynced(scoresLastSyncedAt)}</span>
          )}
        </div>
      )}

      {syncMessage && (
        <p className="muted small" style={{ marginBottom: 12 }}>{syncMessage}</p>
      )}

      {leaderboard.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon">📊</span>
          <p style={{ fontWeight: 700 }}>No teams yet</p>
          <p className="muted small">The leaderboard populates once members submit their picks.</p>
        </div>
      ) : (
        <Scoreboard
          leaderboard={leaderboard}
          currentUserId={currentUserId}
          isLocked={isLocked}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Members
// ---------------------------------------------------------------------------

function MembersTab({
  memberUsers,
  poolId,
  currentPool,
  entries,
  isAdmin,
  isLocked,
}: {
  memberUsers: { id: string; userName: string; email: string }[];
  poolId: string;
  currentPool: Pool;
  entries: { poolId: string; userId: string; submittedAt: string | null }[];
  isAdmin: boolean;
  isLocked: boolean;
}) {
  const { inviteEmails } = useAppState();
  const [inviteInput, setInviteInput] = useState("");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  async function handleInvite() {
    const emails = inviteInput
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length === 0) return;
    await inviteEmails(poolId, emails);
    setInviteInput("");
    setInviteMessage(`Invited ${emails.length} ${emails.length === 1 ? "person" : "people"}.`);
    setTimeout(() => setInviteMessage(null), 4000);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="member-list">
        {memberUsers.map((member) => {
          const entry = entries.find(
            (e) => e.poolId === poolId && e.userId === member.id,
          );
          return (
            <div className="member-row" key={member.id}>
              <div className="member-info">
                <span className="member-name">{member.userName}</span>
                <span className="member-email">{member.email}</span>
              </div>
              <span className="status-pill pending">
                {entry?.submittedAt ? "Submitted" : entry ? "Draft" : "Pending"}
              </span>
            </div>
          );
        })}
      </div>

      {isAdmin && !isLocked && (
        <div className="stack" style={{ marginTop: 8 }}>
          <p
            style={{
              fontSize: "0.78rem",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--muted)",
            }}
          >
            Invite by email
          </p>
          <label className="field">
            <textarea
              rows={2}
              placeholder="email@example.com, another@example.com"
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
            />
          </label>
          <button className="primary-button" onClick={handleInvite} type="button" style={{ alignSelf: "flex-start" }}>
            Send invites
          </button>
          {inviteMessage && <p className="muted small">{inviteMessage}</p>}
          {currentPool.invitedEmails.length > 0 && (
            <p className="muted small">
              Already invited: {currentPool.invitedEmails.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Admin controls
// ---------------------------------------------------------------------------

function AdminTab({
  currentPool,
  golferMap,
  isLocked,
  tournamentId,
  scoresLastSyncedAt,
  onScoresSynced,
}: {
  currentPool: Pool;
  golferMap: Map<string, Golfer>;
  isLocked: boolean;
  tournamentId: string;
  scoresLastSyncedAt: string | null;
  onScoresSynced: (ts: string) => void;
}) {
  const { updatePoolTiers, refreshGolfers } = useAppState();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  function handleTierMove(golferId: string, nextTierId: string) {
    const nextTiers = currentPool.tiers.map((tier) => ({
      ...tier,
      golferIds: tier.golferIds.filter((id) => id !== golferId),
    }));
    const target = nextTiers.find((t) => t.id === nextTierId);
    if (target) target.golferIds = [...target.golferIds, golferId];
    void updatePoolTiers(currentPool.id, nextTiers);
  }

  async function handleSyncScores() {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/scores/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentId }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        eventName?: string;
        updated?: number;
        unmatched?: string[];
        error?: string;
      };
      if (data.ok) {
        setSyncMessage(
          `Synced ${data.updated ?? 0} golfer scores from "${data.eventName}".${
            data.unmatched?.length ? ` (${data.unmatched.length} unmatched)` : ""
          }`,
        );
        await refreshGolfers(tournamentId);
        onScoresSynced(new Date().toISOString());
      } else {
        setSyncMessage(`Sync failed: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      setSyncMessage("Sync failed — check your connection and try again.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Score sync */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p
          style={{
            fontSize: "0.75rem",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--muted)",
          }}
        >
          Live Scores
        </p>
        <div className="sync-controls">
          <button
            className="primary-button small-button"
            onClick={handleSyncScores}
            disabled={isSyncing}
            type="button"
          >
            {isSyncing ? "Syncing…" : "↻ Sync from ESPN"}
          </button>
          {scoresLastSyncedAt && (
            <span className="sync-timestamp">{formatLastSynced(scoresLastSyncedAt)}</span>
          )}
        </div>
        {syncMessage && <p className="muted small">{syncMessage}</p>}
      </div>

      {/* Tier editor (only before lock) */}
      {!isLocked && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p
            style={{
              fontSize: "0.75rem",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--muted)",
            }}
          >
            Tier Assignments
          </p>
          <div className="tier-preview">
            {currentPool.tiers.map((tier) => (
              <div className="tier-card" key={tier.id}>
                <p>{tier.label}</p>
                {tier.golferIds.map((gid) => {
                  const golfer = golferMap.get(gid);
                  if (!golfer) return null;
                  return (
                    <div className="tier-golfer commissioner-golfer" key={golfer.id}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ fontSize: "0.85rem" }}>{golfer.name}</strong>
                        <span
                          className="muted small"
                          style={{ display: "block", marginTop: 2 }}
                        >
                          {golfer.oddsAmerican > 0
                            ? `+${golfer.oddsAmerican}`
                            : golfer.oddsAmerican}{" "}
                          • {(golfer.impliedProbability * 100).toFixed(1)}%
                        </span>
                      </div>
                      <select
                        value={tier.id}
                        onChange={(e) => handleTierMove(golfer.id, e.target.value)}
                        style={{
                          border: "1px solid var(--line)",
                          borderRadius: 10,
                          padding: "4px 8px",
                          fontSize: "0.8rem",
                          background: "white",
                        }}
                      >
                        {currentPool.tiers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main PoolPage
// ---------------------------------------------------------------------------

export function PoolPage({ poolId }: { poolId: string }) {
  const { state, currentUser, isReady } = useAppState();

  const pool = state.pools.find((p) => p.id === poolId);
  const tournament = state.tournaments.find((t) => t.id === pool?.tournamentId);

  // Local golfer map — starts from store, patched live via Supabase Realtime
  const [golferMap, setGolferMap] = useState<Map<string, Golfer>>(new Map());
  const [localSyncedAt, setLocalSyncedAt] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("picks");

  useEffect(() => {
    const storeGolfers = state.golfers.filter(
      (g) => g.tournamentId === tournament?.id,
    );
    setGolferMap(new Map(storeGolfers.map((g) => [g.id, g])));
  }, [state.golfers, tournament?.id]);

  // Supabase Realtime — live score updates
  useEffect(() => {
    if (!tournament?.id) return;
    const tid = tournament.id;
    let cleanup: (() => void) | null = null;

    void getSupabaseBrowserClient().then((supabase) => {
      const channel = supabase
        .channel(`golfers-${tid}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "golfers",
            filter: `tournament_id=eq.${tid}`,
          },
          (payload) => {
            const updated = payload.new as {
              id: string;
              tournament_id: string;
              name: string;
              odds_american: number;
              implied_probability: number;
              current_score_to_par: number;
              position: string;
              made_cut: boolean;
              rounds_complete: number;
            };
            setGolferMap((prev) => {
              const next = new Map(prev);
              next.set(updated.id, {
                id: updated.id,
                tournamentId: updated.tournament_id,
                name: updated.name,
                oddsAmerican: updated.odds_american,
                impliedProbability: updated.implied_probability,
                currentScoreToPar: updated.current_score_to_par,
                position: updated.position,
                madeCut: updated.made_cut,
                roundsComplete: updated.rounds_complete,
              });
              return next;
            });
          },
        )
        .subscribe();

      cleanup = () => {
        void supabase.removeChannel(channel);
      };
    });

    return () => cleanup?.();
  }, [tournament?.id]);

  const liveGolfers = useMemo(() => Array.from(golferMap.values()), [golferMap]);
  const liveState = useMemo(
    () => ({ ...state, golfers: liveGolfers }),
    [state, liveGolfers],
  );

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  if (!isReady) {
    return (
      <main className="centered-page">
        <div className="panel callback-panel">
          <div className="skeleton-line tall medium" />
          <div className="skeleton-line short" />
          <p className="muted small" style={{ marginTop: 4 }}>Loading pool…</p>
        </div>
      </main>
    );
  }

  if (!pool || !tournament) {
    return (
      <main className="centered-page">
        <div className="panel callback-panel" style={{ gap: 14, display: "flex", flexDirection: "column" }}>
          <p className="eyebrow">Not found</p>
          <h1 style={{ fontSize: "1.8rem" }}>Pool not found</h1>
          <p className="muted">This pool doesn&apos;t exist or hasn&apos;t loaded yet.</p>
          <Link className="primary-button" href="/" style={{ alignSelf: "flex-start" }}>
            Return home
          </Link>
        </div>
      </main>
    );
  }

  const currentPool = pool;
  const currentTournament = tournament;

  const isAdmin = currentUser?.id === currentPool.adminUserId;
  const isMember = currentUser
    ? currentPool.memberUserIds.includes(currentUser.id)
    : false;
  const isLocked = isPoolLocked(currentPool);
  const memberUsers = state.users.filter((u) =>
    currentPool.memberUserIds.includes(u.id),
  );
  const existingEntry = currentUser
    ? state.entries.find(
        (e) => e.poolId === poolId && e.userId === currentUser.id,
      )
    : null;
  const leaderboard = buildLeaderboard(liveState, currentPool);

  if (!currentUser || (!isAdmin && !isMember)) {
    return (
      <main className="centered-page">
        <div className="panel callback-panel" style={{ gap: 14, display: "flex", flexDirection: "column" }}>
          <p className="eyebrow">Restricted</p>
          <h1 style={{ fontSize: "1.6rem" }}>Members only</h1>
          <p className="muted">
            This pool is only visible to joined members. Use an invite link or
            enter the join code from your dashboard.
          </p>
          <Link className="primary-button" href="/" style={{ alignSelf: "flex-start" }}>
            Return home
          </Link>
        </div>
      </main>
    );
  }

  // Which tabs to show
  const submittedEntries = state.entries.filter(
    (e) => e.poolId === poolId && e.submittedAt !== null,
  );

  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: "picks", label: "My Picks" },
    { id: "leaderboard", label: "Leaderboard", badge: leaderboard.length || undefined },
    ...(submittedEntries.length > 0
      ? [{ id: "analytics" as TabId, label: "Analytics" }]
      : []),
    { id: "members", label: "Members", badge: memberUsers.length || undefined },
    ...(isAdmin ? [{ id: "admin" as TabId, label: "⚙ Admin" }] : []),
  ];

  const statusLabel = isLocked ? "In progress" : `Locks ${formatDate(currentPool.lockAt)}`;

  return (
    <main className="pool-page-shell">
      {/* ── Pool header ─────────────────────────────────────────────────── */}
      <header className="pool-page-header">
        {/* Back nav + share */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "var(--muted)",
            }}
          >
            ← Pools
          </Link>
          <div className="pool-page-actions">
            <span className="pill" style={{ fontSize: "0.8rem" }}>
              {currentPool.joinCode}
            </span>
            <Link className="secondary-button small-button" href={poolSharePath(currentPool)}>
              Share
            </Link>
          </div>
        </div>

        {/* Title block */}
        <div className="pool-page-header-top">
          <div>
            <p className="eyebrow">{currentTournament.name}</p>
            <h1 className="pool-page-title">{currentPool.name}</h1>
            <p className="pool-page-sub">
              {currentTournament.course} · {statusLabel}
            </p>
          </div>
          {isLocked && (
            <span className="status-pill live" style={{ flexShrink: 0 }}>
              Live
            </span>
          )}
        </div>

        {/* Tab bar */}
        <div className="pool-tab-bar" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`pool-tab-item${activeTab === tab.id ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
            >
              {tab.label}
              {tab.badge !== undefined && (
                <span className="pool-tab-badge">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
      </header>

      {/* ── Tab content ─────────────────────────────────────────────────── */}
      <div className="pool-tab-content" role="tabpanel">
        {activeTab === "picks" && (
          <PicksTab
            pool={currentPool}
            golferMap={golferMap}
            isLocked={isLocked}
            isMember={isMember}
            existingEntry={existingEntry ?? null}
            currentUser={currentUser}
          />
        )}

        {activeTab === "leaderboard" && (
          <LeaderboardTab
            leaderboard={leaderboard}
            isLocked={isLocked}
            isMember={isMember}
            currentUserId={currentUser?.id ?? null}
            tournamentId={currentTournament.id}
            scoresLastSyncedAt={localSyncedAt ?? state.scoresLastSyncedAt}
            onScoresSynced={setLocalSyncedAt}
          />
        )}

        {activeTab === "analytics" && (
          <AnalyticsTab
            leaderboard={leaderboard}
            entries={state.entries}
            pool={currentPool}
            golferMap={golferMap}
            users={state.users}
          />
        )}

        {activeTab === "members" && (
          <MembersTab
            memberUsers={memberUsers}
            poolId={currentPool.id}
            currentPool={currentPool}
            entries={state.entries}
            isAdmin={isAdmin}
            isLocked={isLocked}
          />
        )}

        {activeTab === "admin" && isAdmin && (
          <AdminTab
            currentPool={currentPool}
            golferMap={golferMap}
            isLocked={isLocked}
            tournamentId={currentTournament.id}
            scoresLastSyncedAt={localSyncedAt ?? state.scoresLastSyncedAt}
            onScoresSynced={setLocalSyncedAt}
          />
        )}
      </div>
    </main>
  );
}
