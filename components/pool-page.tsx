"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DraftBoard } from "@/components/draft-board";
import { AnalyticsTab } from "@/components/analytics-tab";
import { isPoolLocked, poolSharePath, validateSelections } from "@/lib/pool";
import { buildLeaderboard } from "@/lib/scoring";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAppState } from "@/lib/store";
import { Golfer, Pool, PoolEntry, TeamSelection } from "@/lib/types";
import { formatDate } from "@/lib/utils";

/** Auto-refresh interval while tournament is in progress (5 minutes) */
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

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
// Masterboard — Augusta Masters-style card grid
// ---------------------------------------------------------------------------

type LbRow = ReturnType<typeof buildLeaderboard>[number];

function mbScoreStr(score: number | null): string {
  if (score === null || score === 0) return "E";
  return score > 0 ? `+${score}` : `${score}`;
}

function mbScoreClass(score: number | null, eliminated?: boolean): string {
  if (eliminated) return "mb-grey";
  if (score === null || score === 0) return "mb-even";
  return score < 0 ? "mb-under" : "mb-over";
}

function lastName(fullName: string): string {
  const parts = fullName.trim().split(" ");
  return parts[parts.length - 1].toUpperCase();
}

function MasterboardCard({
  row,
  rank,
  isElim,
  currentUserId,
  isLocked,
  thruMap,
}: {
  row: LbRow;
  rank: string;
  isElim: boolean;
  currentUserId: string | null;
  isLocked: boolean;
  thruMap: Map<string, string>;
}) {
  const isYou = row.userId === currentUserId;
  const canSeePicks = isLocked || isYou;

  function normForThru(name: string): string {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z\s'-]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getThru(name: string): string {
    const norm = normForThru(name);
    const exact = thruMap.get(norm);
    if (exact) return exact;
    const last = norm.split(" ").at(-1) ?? "";
    return thruMap.get(`__last__${last}`) ?? "-";
  }

  function GolferRow({ g, className }: { g: Golfer; className: string }) {
    const thru = getThru(g.name);
    const isCut = !g.madeCut;
    return (
      <tr key={g.id} className={`${className}${isCut ? " mb-cut-row" : ""}`}>
        <td className="mb-col-rank" />
        <td className="mb-col-name">{lastName(g.name)}</td>
        <td className={`mb-col-score ${isCut ? "mb-grey" : mbScoreClass(g.currentScoreToPar)}`}>
          {isCut ? "CUT" : mbScoreStr(g.currentScoreToPar)}
        </td>
        <td className="mb-col-thru">{isCut ? "" : thru}</td>
      </tr>
    );
  }

  return (
    <table className={`mb-card${isElim ? " mb-card--elim" : ""}`}>
      <colgroup>
        <col className="mb-col-rank" />
        <col className="mb-col-name" />
        <col className="mb-col-score" />
        <col className="mb-col-thru" />
      </colgroup>
      <thead>
        <tr>
          <th className="mb-col-rank">{isElim ? "—" : rank}</th>
          <th className="mb-col-name">
            {row.teamName}
            {isYou && <span style={{ color: "#b89a2e", marginLeft: 4, fontSize: "0.6rem" }}>★</span>}
          </th>
          <th className={`mb-col-score ${mbScoreClass(row.teamScore, isElim)}`}>
            {isElim ? "OUT" : mbScoreStr(row.teamScore)}
          </th>
          <th className="mb-col-thru" />
        </tr>
      </thead>
      <tbody>
        {canSeePicks ? (
          <>
            {row.countingGolfers.map((g) => (
              <GolferRow key={g.id} g={g} className="mb-counting" />
            ))}
            {row.benchGolfers.map((g, idx) => (
              <GolferRow key={g.id} g={g} className={`mb-bench${idx === 0 ? " mb-bench-first" : ""}`} />
            ))}
          </>
        ) : (
          <tr className="mb-counting">
            <td colSpan={4} style={{ textAlign: "center", fontStyle: "italic", color: "#9ca8b6", fontSize: "0.7rem", padding: "10px" }}>
              Picks revealed at lock
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Masterboard({
  leaderboard,
  currentUserId,
  isLocked,
  thruMap,
}: {
  leaderboard: ReturnType<typeof buildLeaderboard>;
  currentUserId: string | null;
  isLocked: boolean;
  thruMap: Map<string, string>;
}) {
  const activeRows = leaderboard.filter((r) => r.status !== "eliminated");
  const eliminatedRows = leaderboard.filter((r) => r.status === "eliminated");

  function rankOf(row: LbRow): string {
    const myScore = row.teamScore ?? 999;
    const betterCount = activeRows.filter((r) => (r.teamScore ?? 999) < myScore).length;
    const rank = betterCount + 1;
    const tied = activeRows.filter((r) => (r.teamScore ?? 999) === myScore).length > 1;
    return tied ? `T${rank}` : `${rank}`;
  }

  return (
    <div className="mb-shell">
      <div className="mb-banner">
        <span className="mb-banner-title">Leaders</span>
      </div>


      <div className="mb-grid">
        {activeRows.map((row) => (
          <MasterboardCard
            key={row.entryId}
            row={row}
            rank={rankOf(row)}
            isElim={false}
            currentUserId={currentUserId}
            isLocked={isLocked}
            thruMap={thruMap}
          />
        ))}
      </div>

      {eliminatedRows.length > 0 && (
        <>
          <div className="mb-elim-sep">
            <span className="mb-elim-sep-line" />
            <span className="mb-elim-sep-label">Eliminated</span>
            <span className="mb-elim-sep-line" />
          </div>
          <div className="mb-grid">
            {eliminatedRows.map((row) => (
              <MasterboardCard
                key={row.entryId}
                row={row}
                rank="—"
                isElim={true}
                currentUserId={currentUserId}
                isLocked={isLocked}
                thruMap={thruMap}
              />
            ))}
          </div>
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
  golferMap,
  entries,
  users,
}: {
  leaderboard: ReturnType<typeof buildLeaderboard>;
  isLocked: boolean;
  isMember: boolean;
  currentUserId: string | null;
  tournamentId: string;
  scoresLastSyncedAt: string | null;
  onScoresSynced: (ts: string) => void;
  golferMap: Map<string, Golfer>;
  entries: PoolEntry[];
  users: { id: string; userName: string }[];
}) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [view, setView] = useState<"pool" | "tournament">("pool");
  const [thruMap, setThruMap] = useState<Map<string, string>>(new Map());
  const { refreshGolfers } = useAppState();

  // Fetch tournament leaderboard data to power the Thru column in pool cards
  useEffect(() => {
    if (!isLocked) return;
    function normName(name: string): string {
      return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s'-]/g, "").replace(/\s+/g, " ").trim();
    }
    fetch(`/api/scores/tournament?tournamentId=${encodeURIComponent(tournamentId)}`)
      .then((r) => r.json())
      .then((data: { ok: boolean; golfers?: TournamentGolferRow[] }) => {
        if (!data.ok || !data.golfers) return;
        const map = new Map<string, string>();
        for (const g of data.golfers) {
          const norm = normName(g.name);
          map.set(norm, g.thru);
          const last = norm.split(" ").at(-1) ?? "";
          if (last) map.set(`__last__${last}`, g.thru);
        }
        setThruMap(map);
      })
      .catch(() => { /* thru data is best-effort */ });
  }, [isLocked, tournamentId]);

  const handleSyncScores = useCallback(async (silent = false) => {
    if (!silent) setIsSyncing(true);
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
        if (!silent) setSyncMessage(`Synced ${data.updated ?? 0} scores from "${data.eventName}".`);
        await refreshGolfers(tournamentId);
        onScoresSynced(new Date().toISOString());
      } else {
        if (!silent) setSyncMessage(`Sync failed: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      if (!silent) setSyncMessage("Sync failed — check your connection.");
    } finally {
      if (!silent) setIsSyncing(false);
    }
  }, [tournamentId, refreshGolfers, onScoresSynced]);

  // Sync on mount + every 5 minutes when tournament is live
  useEffect(() => {
    if (!isLocked) return;
    void handleSyncScores(true);
    const timer = setInterval(() => {
      void handleSyncScores(true);
    }, AUTO_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isLocked, handleSyncScores]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Sub-view toggle */}
      <div className="leaderboard-view-toggle" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className={view === "pool" ? "primary-button small-button" : "secondary-button small-button"}
          onClick={() => setView("pool")}
        >
          Pool Leaderboard
        </button>
        <button
          type="button"
          className={view === "tournament" ? "primary-button small-button" : "secondary-button small-button"}
          onClick={() => setView("tournament")}
        >
          Tournament Leaderboard
        </button>
      </div>

      {syncMessage && (
        <p className="muted small" style={{ marginBottom: 12 }}>{syncMessage}</p>
      )}

      {view === "pool" ? (
        leaderboard.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">📊</span>
            <p style={{ fontWeight: 700 }}>No teams yet</p>
            <p className="muted small">The leaderboard populates once members submit their picks.</p>
          </div>
        ) : (
          <Masterboard
            leaderboard={leaderboard}
            currentUserId={currentUserId}
            isLocked={isLocked}
            thruMap={thruMap}
          />
        )
      ) : (
        <TournamentLeaderboard
          tournamentId={tournamentId}
          golferMap={golferMap}
          entries={entries}
          users={users}
          leaderboard={leaderboard}
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

      {/* Danger zone — delete tournament */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        <p
          style={{
            fontSize: "0.75rem",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--danger)",
          }}
        >
          Danger Zone
        </p>
        <button
          type="button"
          className="danger-button small-button"
          onClick={async () => {
            const confirmed = window.confirm(
              "Are you sure you want to delete this tournament? This cannot be undone.",
            );
            if (!confirmed) return;
            const res = await fetch(`/api/tournaments/${tournamentId}`, { method: "DELETE" });
            const data = (await res.json()) as { ok: boolean; error?: string };
            if (data.ok) {
              window.location.href = "/";
            } else {
              alert(`Failed to delete tournament: ${data.error ?? "Unknown error"}`);
            }
          }}
        >
          Delete Tournament
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tournament Leaderboard component
// ---------------------------------------------------------------------------

type TournamentGolferRow = {
  name: string;
  position: string;
  score: number;
  today: number | null;
  thru: string;
  r1: number | null;
  r2: number | null;
  r3: number | null;
  r4: number | null;
  madeCut: boolean;
};

type SortKey = "position" | "name" | "score" | "today" | "thru" | "r1" | "r2" | "r3" | "r4";

function positionSortValue(pos: string): number {
  if (pos === "CUT" || pos === "WD" || pos === "DQ") return 9999;
  const n = parseInt(pos.replace(/^T/, ""), 10);
  return isNaN(n) ? 9998 : n;
}

function TournamentLeaderboard({
  tournamentId,
  golferMap,
  entries,
  users,
  leaderboard,
}: {
  tournamentId: string;
  golferMap: Map<string, Golfer>;
  entries: PoolEntry[];
  users: { id: string; userName: string }[];
  leaderboard: ReturnType<typeof buildLeaderboard>;
}) {
  const [golfers, setGolfers] = useState<TournamentGolferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("position");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/scores/tournament?tournamentId=${encodeURIComponent(tournamentId)}`)
      .then((r) => r.json())
      .then((data: { ok: boolean; golfers?: TournamentGolferRow[]; error?: string }) => {
        if (data.ok && data.golfers) {
          setGolfers(data.golfers);
        } else {
          setError(data.error ?? "Failed to load tournament data.");
        }
      })
      .catch(() => setError("Failed to load tournament data."))
      .finally(() => setLoading(false));
  }, [tournamentId]);

  // Normalize names the same way the sync does: lowercase, strip diacritics,
  // remove non-alpha chars, collapse whitespace.
  function normName(name: string): string {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z\s'-]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Build a map from normalized golfer name → team names.
  // Also index by last name alone as a fallback.
  const golferNameToTeams = useMemo<Map<string, string[]>>(() => {
    const map = new Map<string, string[]>();
    const addEntry = (key: string, teamName: string) => {
      const existing = map.get(key) ?? [];
      if (!existing.includes(teamName)) existing.push(teamName);
      map.set(key, existing);
    };
    for (const row of leaderboard) {
      const allGolfers = [...row.countingGolfers, ...row.benchGolfers];
      for (const g of allGolfers) {
        const norm = normName(g.name);
        addEntry(norm, row.teamName);
        // Also index by last name for fuzzy fallback
        const lastName = norm.split(" ").at(-1) ?? "";
        if (lastName) addEntry(`__last__${lastName}`, row.teamName);
      }
    }
    return map;
  }, [leaderboard]);

  // Look up teams for an ESPN golfer name, with last-name fallback
  function teamsForGolfer(espnName: string): string[] {
    const norm = normName(espnName);
    const exact = golferNameToTeams.get(norm);
    if (exact && exact.length > 0) return exact;
    const lastName = norm.split(" ").at(-1) ?? "";
    return golferNameToTeams.get(`__last__${lastName}`) ?? [];
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function sortedGolfers(): TournamentGolferRow[] {
    return [...golfers].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "position":
          cmp = positionSortValue(a.position) - positionSortValue(b.position);
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "score":
          cmp = a.score - b.score;
          break;
        case "today":
          cmp = (a.today ?? 999) - (b.today ?? 999);
          break;
        case "thru":
          cmp = a.thru.localeCompare(b.thru);
          break;
        case "r1":
          cmp = (a.r1 ?? 999) - (b.r1 ?? 999);
          break;
        case "r2":
          cmp = (a.r2 ?? 999) - (b.r2 ?? 999);
          break;
        case "r3":
          cmp = (a.r3 ?? 999) - (b.r3 ?? 999);
          break;
        case "r4":
          cmp = (a.r4 ?? 999) - (b.r4 ?? 999);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return <span style={{ marginLeft: 4, opacity: 0.6 }}>{sortAsc ? "↑" : "↓"}</span>;
  }

  if (loading) {
    return (
      <div className="tournament-lb-loading">
        <div className="tournament-lb-spinner" />
        <p className="muted small">Loading tournament leaderboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🏌️</span>
        <p style={{ fontWeight: 700 }}>Could not load leaderboard</p>
        <p className="muted small">{error}</p>
      </div>
    );
  }

  if (golfers.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">🏌️</span>
        <p style={{ fontWeight: 700 }}>No data available</p>
        <p className="muted small">Tournament leaderboard data is not yet available.</p>
      </div>
    );
  }

  const rows = sortedGolfers();

  return (
    <div className="tournament-lb-wrapper">
      <div className="tournament-lb-scroll">
        <table className="tournament-lb-table">
          <thead>
            <tr>
              {(
                [
                  { key: "position" as SortKey, label: "Pos" },
                  { key: "name" as SortKey, label: "Golfer" },
                  { key: "score" as SortKey, label: "Score" },
                  { key: "today" as SortKey, label: "Today" },
                  { key: "thru" as SortKey, label: "Thru" },
                  { key: "r1" as SortKey, label: "R1" },
                  { key: "r2" as SortKey, label: "R2" },
                  { key: "r3" as SortKey, label: "R3" },
                  { key: "r4" as SortKey, label: "R4" },
                ] as { key: SortKey; label: string }[]
              ).map(({ key, label }) => (
                <th
                  key={key}
                  className="tournament-lb-th"
                  onClick={() => handleSort(key)}
                  style={{ cursor: "pointer", userSelect: "none" }}
                >
                  {label}{sortIndicator(key)}
                </th>
              ))}
              <th className="tournament-lb-th">Teams</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const teams = teamsForGolfer(g.name);
              const isCut = !g.madeCut;
              return (
                <tr key={g.name} className={`tournament-lb-row${isCut ? " tournament-lb-row--cut" : ""}`}>
                  <td className="tournament-lb-td tournament-lb-pos">{g.position}</td>
                  <td className="tournament-lb-td tournament-lb-name">{g.name}</td>
                  <td className="tournament-lb-td tournament-lb-score">
                    <span className={scoreBadgeClass(g.score)}>{isCut ? "—" : scoreLabel(g.score)}</span>
                  </td>
                  <td className="tournament-lb-td tournament-lb-today">
                    {g.today !== null ? (
                      <span className={scoreBadgeClass(g.today - 72)}>{g.today}</span>
                    ) : "—"}
                  </td>
                  <td className="tournament-lb-td tournament-lb-thru">{g.thru}</td>
                  <td className="tournament-lb-td">{g.r1 ?? "—"}</td>
                  <td className="tournament-lb-td">{g.r2 ?? "—"}</td>
                  <td className="tournament-lb-td">{g.r3 ?? "—"}</td>
                  <td className="tournament-lb-td">{g.r4 ?? "—"}</td>
                  <td className="tournament-lb-td tournament-lb-teams">
                    {teams.map((team) => (
                      <span key={team} className="tournament-lb-team-badge">{team}</span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
    const message = pool && !tournament
      ? "The tournament for this pool has been deleted."
      : "This pool doesn't exist or you don't have access.";
    return (
      <main className="centered-page">
        <div className="panel callback-panel" style={{ gap: 14, display: "flex", flexDirection: "column" }}>
          <p className="eyebrow">Not found</p>
          <h1 style={{ fontSize: "1.8rem" }}>Pool not found</h1>
          <p className="muted">{message}</p>
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
            golferMap={golferMap}
            entries={state.entries}
            users={state.users}
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
