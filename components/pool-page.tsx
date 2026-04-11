"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DraftBoard } from "@/components/draft-board";
import { AnalyticsTab } from "@/components/analytics-tab";
import { isPoolLocked, poolSharePath, validateSelections } from "@/lib/pool";
import { buildLeaderboard } from "@/lib/scoring";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useAppState } from "@/lib/store";
import { Golfer, Pool, PoolEntry, TeamSelection, Tier, Tournament } from "@/lib/types";
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

type TabId = "picks" | "tiers" | "leaderboard" | "analytics" | "members" | "admin";

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

  if (!pool.tiersSubmittedAt) {
    return (
      <div className="empty-state">
        <span className="empty-state-icon">⛳</span>
        <p style={{ fontWeight: 700 }}>Tiers not finalized yet</p>
        <p className="muted small">
          The commissioner is setting up the tiers. Drafting opens once they&apos;re submitted.
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
    <div style={{ position: "relative" }}>
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
            {isElim && (
              <span style={{
                marginLeft: 10,
                color: "#e00",
                fontWeight: 900,
                fontSize: "0.85rem",
                letterSpacing: "0.06em",
                fontStyle: "italic",
                textShadow: "0 1px 2px rgba(0,0,0,0.3)",
              }}>
                MISSED THE CUT
              </span>
            )}
          </th>
          <th className={`mb-col-score ${mbScoreClass(row.teamScore, isElim)}`}>
            {isElim ? "—" : mbScoreStr(row.teamScore)}
          </th>
          <th className="mb-col-thru">
            {isElim && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/tiger_dui.png"
                alt=""
                style={{ height: 52, display: "block", marginLeft: "auto" }}
              />
            )}
          </th>
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
    </div>
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
  onEspnScores,
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
  onEspnScores: (scores: Map<string, { score: number; position: string; madeCut: boolean }>) => void;
  golferMap: Map<string, Golfer>;
  entries: PoolEntry[];
  users: { id: string; userName: string }[];
}) {
  const [view, setView] = useState<"pool" | "tournament">("pool");
  const [thruMap, setThruMap] = useState<Map<string, string>>(new Map());

  // Keep refs to callbacks so the interval never needs to re-register
  const onEspnScoresRef = useRef(onEspnScores);
  const onScoresSyncedRef = useRef(onScoresSynced);
  useEffect(() => { onEspnScoresRef.current = onEspnScores; });
  useEffect(() => { onScoresSyncedRef.current = onScoresSynced; });

  // Fetch on mount + refresh every 5 minutes when tournament is live.
  // Effect only depends on isLocked/tournamentId — callbacks accessed via refs
  // to avoid re-registering the interval on every store state update.
  useEffect(() => {
    if (!isLocked) return;

    async function fetchLiveScores() {
      try {
        const res = await fetch(`/api/scores/tournament?tournamentId=${encodeURIComponent(tournamentId)}`);
        const data = (await res.json()) as { ok: boolean; golfers?: TournamentGolferRow[] };
        if (!data.ok || !data.golfers) return;

        function normName(name: string): string {
          return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s'-]/g, "").replace(/\s+/g, " ").trim();
        }

        // Build ESPN score map keyed by normalized name — passed up to PoolPage
        // so it merges with Supabase roster data regardless of load order.
        const scoreMap = new Map(data.golfers.map((g) => [
          normName(g.name),
          { score: g.score, position: g.position, madeCut: g.madeCut },
        ]));
        onEspnScoresRef.current(scoreMap);

        // Also update thruMap for pool cards
        const thru = new Map<string, string>();
        for (const g of data.golfers) {
          const norm = normName(g.name);
          thru.set(norm, g.thru);
          const last = norm.split(" ").at(-1) ?? "";
          if (last) thru.set(`__last__${last}`, g.thru);
        }
        setThruMap(thru);
        onScoresSyncedRef.current(new Date().toISOString());
      } catch {
        // best-effort
      }
    }

    void fetchLiveScores();
    const timer = setInterval(() => void fetchLiveScores(), AUTO_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isLocked, tournamentId]);

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
// Tab: Tiers
// ---------------------------------------------------------------------------

type TournamentImportPayload = {
  tournament: Tournament;
  golfers: Golfer[];
};

const DEFAULT_TIER_SPLITS = [0.05, 0.1, 0.1, 0.15, 0.15];

function buildDefaultBoundaries(totalGolfers: number) {
  const boundaries: number[] = [];
  let runningCount = 0;
  DEFAULT_TIER_SPLITS.forEach((split, index) => {
    const remainingPlayers = totalGolfers - runningCount;
    const tiersRemainingAfterCurrent = DEFAULT_TIER_SPLITS.length - index;
    const targetCount = Math.round(totalGolfers * split);
    const maxCount = Math.max(1, remainingPlayers - tiersRemainingAfterCurrent);
    const tierCount = Math.max(1, Math.min(maxCount, targetCount));
    runningCount += tierCount;
    boundaries.push(runningCount);
  });
  return boundaries;
}

function getTierBoundaries(tiers: Tier[]) {
  const boundaries: number[] = [];
  let runningCount = 0;
  tiers.slice(0, -1).forEach((tier) => {
    runningCount += tier.golferIds.length;
    boundaries.push(runningCount);
  });
  return boundaries;
}

function buildTiersFromBoundaries(orderedGolfers: Golfer[], boundaries: number[]): Tier[] {
  const slices = [...boundaries, orderedGolfers.length];
  let start = 0;
  return slices.map((end, index) => {
    const golferIds = orderedGolfers.slice(start, end).map((g) => g.id);
    start = end;
    return { id: `tier-${index + 1}`, label: `Tier ${index + 1}`, golferIds };
  });
}

function TiersTab({
  currentPool,
  tournament,
  golferMap,
  isAdmin,
}: {
  currentPool: Pool;
  tournament: Tournament;
  golferMap: Map<string, Golfer>;
  isAdmin: boolean;
}) {
  const { updatePoolTiers, submitTiers, importTournamentFeed } = useAppState();
  const tiersSubmitted = Boolean(currentPool.tiersSubmittedAt);
  const [localTiers, setLocalTiers] = useState<Tier[]>(currentPool.tiers);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  // Golfers sorted by implied probability descending (same order as wizard)
  const orderedGolfers = useMemo(
    () => Array.from(golferMap.values()).sort((a, b) => b.impliedProbability - a.impliedProbability),
    [golferMap],
  );

  const tierBoundaries = useMemo(() => getTierBoundaries(localTiers), [localTiers]);

  useEffect(() => {
    if (!isDirty) setLocalTiers(currentPool.tiers);
  }, [currentPool.tiers, isDirty]);

  // --- Slider drag logic (ported from wizard) ---
  function handleBoundaryChange(boundaryIndex: number, nextValue: number) {
    const currentBoundaries = getTierBoundaries(localTiers);
    const min = boundaryIndex === 0 ? 1 : currentBoundaries[boundaryIndex - 1] + 1;
    const max =
      boundaryIndex === currentBoundaries.length - 1
        ? orderedGolfers.length - 1
        : currentBoundaries[boundaryIndex + 1] - 1;
    const clamped = Math.max(min, Math.min(max, nextValue));
    const nextBoundaries = [...currentBoundaries];
    nextBoundaries[boundaryIndex] = clamped;
    setLocalTiers(buildTiersFromBoundaries(orderedGolfers, nextBoundaries));
    setIsDirty(true);
    setMessage(null);
  }

  function handleBoundaryPointerDown(boundaryIndex: number, clientX: number) {
    const rail = railRef.current;
    if (!rail || orderedGolfers.length === 0) return;
    const rect = rail.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const nextValue = Math.round(Math.max(0, Math.min(1, ratio)) * orderedGolfers.length);
    handleBoundaryChange(boundaryIndex, nextValue);
  }

  function startBoundaryDrag(boundaryIndex: number, event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const onMove = (e: PointerEvent) => handleBoundaryPointerDown(boundaryIndex, e.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    handleBoundaryPointerDown(boundaryIndex, event.clientX);
  }

  function handleResetTiers() {
    setLocalTiers(buildTiersFromBoundaries(orderedGolfers, buildDefaultBoundaries(orderedGolfers.length)));
    setIsDirty(true);
    setMessage(null);
  }

  async function handleSaveTiers() {
    setIsSaving(true);
    setMessage(null);
    try {
      await updatePoolTiers(currentPool.id, localTiers);
      setIsDirty(false);
      setMessage("Tiers saved.");
    } catch {
      setMessage("Failed to save tiers.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRefreshOdds() {
    if (!tournament.id.startsWith("dk-")) {
      setMessage("Odds refresh is only available for DraftKings tournaments.");
      return;
    }
    const slug = tournament.id.slice(3);
    const leagueId = tournament.importMeta?.leagueId;
    setIsRefreshing(true);
    setMessage(null);
    try {
      const params = new URLSearchParams();
      if (leagueId) params.set("leagueId", String(leagueId));
      const res = await fetch(`/api/draftkings/tournament/${slug}${params.size ? `?${params.toString()}` : ""}`);
      const payload = (await res.json()) as Partial<TournamentImportPayload> & { error?: string };
      if (!res.ok || !payload.tournament || !payload.golfers) {
        throw new Error(payload.error ?? "Failed to refresh odds.");
      }
      await importTournamentFeed(payload.tournament, payload.golfers);
      // Rebuild tiers from refreshed golfer list, preserving current boundaries
      const newOrdered = [...payload.golfers].sort((a, b) => b.impliedProbability - a.impliedProbability);
      const newTiers = buildTiersFromBoundaries(newOrdered, getTierBoundaries(localTiers));
      setLocalTiers(newTiers);
      setIsDirty(true);
      setMessage(`Odds refreshed — ${payload.golfers.length} golfers updated. Save or submit tiers to keep changes.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to refresh odds.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleSubmitTiers() {
    setIsSubmitting(true);
    setMessage(null);
    try {
      if (isDirty) await updatePoolTiers(currentPool.id, localTiers);
      await submitTiers(currentPool.id);
      setIsDirty(false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to submit tiers.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const busy = isSaving || isRefreshing || isSubmitting;

  // --- Locked / non-admin: simple read-only card grid ---
  if (tiersSubmitted || !isAdmin) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {tiersSubmitted ? (
          <div className="notice"><p><strong>Tiers locked</strong> — drafting is open for all members.</p></div>
        ) : (
          <div className="notice"><p>The commissioner is finalizing tiers. Drafting opens once submitted.</p></div>
        )}
        <div className="tier-board full-tier-board">
          {localTiers.map((tier) => (
            <div className="tier-column expanded-tier-column" key={tier.id}>
              <div className="tier-column-head">
                <p>{tier.label}</p>
                <span>{tier.golferIds.length} pl.</span>
              </div>
              <div className="tier-column-list">
                {tier.golferIds.map((gid) => {
                  const golfer = golferMap.get(gid);
                  if (!golfer) return null;
                  return (
                    <div className="tier-player-row" key={gid}>
                      <strong>{golfer.name}</strong>
                      <div className="tier-player-meta">
                        <span>{golfer.oddsAmerican > 0 ? `+${golfer.oddsAmerican}` : golfer.oddsAmerican}</span>
                        <span>{(golfer.impliedProbability * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- Admin edit view: slider + full tier board ---
  return (
    <div className="wizard-stage-card tier-editor-shell">
      <div className="tier-editor-card">
        <div className="tier-toolbar">
          <h2>Draft Tier Configuration</h2>
          <div className="draft-actions">
            <button className="secondary-button" type="button" onClick={handleResetTiers} disabled={busy}>
              Reset Tiers
            </button>
            <button className="secondary-button small-button" onClick={handleRefreshOdds} disabled={busy} type="button">
              {isRefreshing ? "Refreshing…" : "↻ Refresh Odds"}
            </button>
            {isDirty && (
              <button className="secondary-button small-button" onClick={handleSaveTiers} disabled={busy} type="button">
                {isSaving ? "Saving…" : "Save"}
              </button>
            )}
            <button className="primary-button" onClick={handleSubmitTiers} disabled={busy} type="button">
              {isSubmitting ? "Submitting…" : "Submit Tiers"}
            </button>
          </div>
        </div>

        {message && <p className="muted small" style={{ marginTop: 4 }}>{message}</p>}

        <div className="tier-slider-panel">
          <div className="tier-slider-meta">
            {localTiers.map((tier) => (
              <div className="tier-slider-label" key={tier.id}>
                <span>{tier.label}</span>
                <strong>
                  {orderedGolfers.length
                    ? `${Math.round((tier.golferIds.length / orderedGolfers.length) * 100)}% (${tier.golferIds.length})`
                    : "0% (0)"}
                </strong>
              </div>
            ))}
          </div>
          <div className="tier-slider-controls" ref={railRef}>
            <div className="tier-slider-rail" />
            {tierBoundaries.map((boundary, index) => (
              <button
                aria-label={`Adjust ${localTiers[index].label} boundary`}
                className="tier-slider-handle"
                key={localTiers[index].id}
                onPointerDown={(e) => startBoundaryDrag(index, e)}
                style={{ left: `calc(${(boundary / orderedGolfers.length) * 100}% - 8px)` }}
                type="button"
                disabled={busy}
              />
            ))}
          </div>
        </div>

        <div className="tier-board full-tier-board">
          {localTiers.map((tier) => (
            <div className="tier-column expanded-tier-column" key={tier.id}>
              <div className="tier-column-head">
                <p>{tier.label}</p>
                <span>{tier.golferIds.length} pl.</span>
              </div>
              <div className="tier-column-list">
                {tier.golferIds.map((gid) => {
                  const golfer = golferMap.get(gid);
                  if (!golfer) return null;
                  return (
                    <div className="tier-player-row" key={gid}>
                      <strong>{golfer.name}</strong>
                      <div className="tier-player-meta">
                        <span>{golfer.oddsAmerican > 0 ? `+${golfer.oddsAmerican}` : golfer.oddsAmerican}</span>
                        <span>{(golfer.impliedProbability * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
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
  const { refreshGolfers } = useAppState();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

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
              "Are you sure you want to delete this pool? The tournament and golfer data will not be affected. This cannot be undone.",
            );
            if (!confirmed) return;
            const res = await fetch(`/api/pools/${currentPool.id}`, { method: "DELETE" });
            const data = (await res.json()) as { ok: boolean; error?: string };
            if (data.ok) {
              window.location.href = "/";
            } else {
              alert(`Failed to delete pool: ${data.error ?? "Unknown error"}`);
            }
          }}
        >
          Delete Pool
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
  isLocked,
}: {
  tournamentId: string;
  golferMap: Map<string, Golfer>;
  entries: PoolEntry[];
  users: { id: string; userName: string }[];
  leaderboard: ReturnType<typeof buildLeaderboard>;
  isLocked: boolean;
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
    // Never build pick data into state before the pool locks — return an empty
    // map so picks are never accessible via React devtools or accidental renders.
    if (!isLocked) return new Map();
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
  }, [leaderboard, isLocked]);

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
              {isLocked && <th className="tournament-lb-th">Teams</th>}
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
                  {isLocked && (
                    <td className="tournament-lb-td tournament-lb-teams">
                      {teams.map((team) => (
                        <span key={team} className="tournament-lb-team-badge">{team}</span>
                      ))}
                    </td>
                  )}
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
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // ESPN live scores stored separately so they can arrive before or after
  // Supabase golfers load without a race condition.
  type EspnScore = { score: number; position: string; madeCut: boolean };
  const [espnScores, setEspnScores] = useState<Map<string, EspnScore>>(new Map());

  useEffect(() => {
    function normName(s: string): string {
      return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s'-]/g, "").replace(/\s+/g, " ").trim();
    }
    const storeGolfers = state.golfers.filter((g) => g.tournamentId === tournament?.id);
    const merged = new Map(storeGolfers.map((g): [string, Golfer] => {
      const normed = normName(g.name);
      let espn = espnScores.get(normed);
      if (!espn) {
        const last = normed.split(" ").at(-1) ?? "";
        for (const [key, val] of espnScores) {
          if (key.endsWith(` ${last}`) || key === last) { espn = val; break; }
        }
      }
      if (!espn) return [g.id, g];
      return [g.id, { ...g, currentScoreToPar: espn.score, position: espn.position, madeCut: espn.madeCut }];
    }));
    setGolferMap(merged);
  }, [state.golfers, tournament?.id, espnScores]);

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
    { id: "tiers", label: "Tiers" },
    { id: "leaderboard", label: "Leaderboard", badge: leaderboard.length || undefined },
    ...(isLocked && submittedEntries.length > 0
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
            <button
              className="secondary-button small-button"
              type="button"
              onClick={() => { setShowShareModal(true); setShareCopied(false); }}
            >
              Share
            </button>
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

        {activeTab === "tiers" && (
          <TiersTab
            currentPool={currentPool}
            tournament={currentTournament}
            golferMap={golferMap}
            isAdmin={isAdmin}
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
            onEspnScores={setEspnScores}
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
            tournament={currentTournament}
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

      {/* ── Share modal ─────────────────────────────────────────────────── */}
      {showShareModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowShareModal(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface, #fff)", borderRadius: 16, padding: 28,
              width: "min(420px, 92vw)", display: "flex", flexDirection: "column", gap: 16,
              boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, margin: 0 }}>Invite friends</h3>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "var(--muted)", lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            <p className="muted small" style={{ margin: 0 }}>
              Share this link — anyone with it can join <strong>{currentPool.name}</strong>.
            </p>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                readOnly
                value={`${typeof window !== "undefined" ? window.location.origin : ""}${poolSharePath(currentPool)}`}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line)",
                  fontSize: "0.85rem", background: "var(--bg, #f7f8fa)", color: "var(--text)",
                  minWidth: 0,
                }}
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="primary-button small-button"
                onClick={() => {
                  const url = `${window.location.origin}${poolSharePath(currentPool)}`;
                  void navigator.clipboard.writeText(url).then(() => {
                    setShareCopied(true);
                    setTimeout(() => setShareCopied(false), 2500);
                  });
                }}
              >
                {shareCopied ? "Copied ✓" : "Copy"}
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="muted small">Join code:</span>
              <span className="pill" style={{ fontSize: "0.8rem", fontWeight: 700 }}>{currentPool.joinCode}</span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
