"use client";

import { useState } from "react";
import { Golfer, Pool, TeamSelection, Tier } from "@/lib/types";

type Props = {
  pool: Pool;
  golferMap: Map<string, Golfer>;
  selections: TeamSelection[];
  onSelectionChange: (tierId: string, golferId: string) => void;
  onSubmit: () => void;
  draftMessage: string | null;
  existingSubmittedAt: string | null;
  isLocked: boolean;
  isValid: boolean;
  isDirty: boolean; // picks have changed since last submit
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function oddsLabel(g: Golfer): string {
  if (!g.oddsAmerican) return "";
  return g.oddsAmerican > 0 ? `+${g.oddsAmerican}` : `${g.oddsAmerican}`;
}

function probLabel(g: Golfer): string {
  if (!g.impliedProbability) return "";
  return `${(g.impliedProbability * 100).toFixed(1)}%`;
}

function scoreLabel(score: number): string {
  if (score === 0) return "E";
  return score > 0 ? `+${score}` : `${score}`;
}

function scoreBadgeClass(score: number): string {
  if (score < 0) return "score-badge under";
  if (score > 0) return "score-badge over";
  return "score-badge even";
}

// ---------------------------------------------------------------------------
// Locked view — final picks with live scores
// ---------------------------------------------------------------------------

function LockedDraftView({
  pool,
  golferMap,
  selections,
  existingSubmittedAt,
}: {
  pool: Pool;
  golferMap: Map<string, Golfer>;
  selections: TeamSelection[];
  existingSubmittedAt: string | null;
}) {
  if (selections.length === 0) {
    return (
      <div className="draft-locked-notice">
        <span style={{ fontSize: "1.5rem" }}>🔒</span>
        <div>
          <p style={{ fontWeight: 700 }}>Pool is locked</p>
          <p className="muted small">No picks were submitted before lock.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {existingSubmittedAt && (
        <div className="draft-locked-notice">
          <span style={{ fontSize: "1.2rem" }}>✅</span>
          <p className="small muted">Picks locked in — good luck!</p>
        </div>
      )}
      <div className="draft-summary">
        {pool.tiers.map((tier) => {
          const sel = selections.find((s) => s.tierId === tier.id);
          const g = sel ? golferMap.get(sel.golferId) : null;
          return (
            <div className="draft-summary-row" key={tier.id} style={{ cursor: "default" }}>
              <div className="draft-summary-left">
                <span className="draft-summary-tier">{tier.label}</span>
                {g ? (
                  <span className="draft-summary-golfer">{g.name}</span>
                ) : (
                  <span className="muted small">—</span>
                )}
              </div>
              {g && g.position ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={scoreBadgeClass(g.currentScoreToPar)}>
                    {g.madeCut === false ? "CUT" : scoreLabel(g.currentScoreToPar)}
                  </span>
                  <span className="muted small">{g.position}</span>
                </div>
              ) : g ? (
                <span className="muted small">{oddsLabel(g)}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active draft board
// ---------------------------------------------------------------------------

export function DraftBoard({
  pool,
  golferMap,
  selections,
  onSelectionChange,
  onSubmit,
  draftMessage,
  existingSubmittedAt,
  isLocked,
  isValid,
  isDirty,
}: Props) {
  const [activeTierIndex, setActiveTierIndex] = useState(0);

  const tiers = pool.tiers;
  const totalTiers = tiers.length;
  const activeTier: Tier | undefined = tiers[activeTierIndex];

  if (isLocked) {
    return (
      <LockedDraftView
        pool={pool}
        golferMap={golferMap}
        selections={selections}
        existingSubmittedAt={existingSubmittedAt}
      />
    );
  }

  if (!activeTier) return null;

  const activeGolferId = selections.find((s) => s.tierId === activeTier.id)?.golferId ?? null;
  const selectedGolfer = activeGolferId ? golferMap.get(activeGolferId) : null;

  // Submit is active when all picks are made AND (not yet submitted OR picks changed)
  const submitActive = isValid && (!existingSubmittedAt || isDirty);
  const submitLabel = !isValid
    ? "Submit ✓"
    : isDirty || !existingSubmittedAt
      ? "Submit ✓"
      : "Submitted ✓";

  function handlePickGolfer(tierId: string, golferId: string) {
    onSelectionChange(tierId, golferId);
    // Auto-advance to next unpicked tier
    const currentIdx = tiers.findIndex((t) => t.id === tierId);
    const nextUnpicked = tiers.findIndex(
      (t, i) => i > currentIdx && !selections.some((s) => s.tierId === t.id && s.golferId !== (t.id === tierId ? golferId : "")),
    );
    if (nextUnpicked !== -1) {
      setTimeout(() => setActiveTierIndex(nextUnpicked), 240);
    } else if (currentIdx < totalTiers - 1) {
      setTimeout(() => setActiveTierIndex(currentIdx + 1), 240);
    }
  }

  function goTo(idx: number) {
    setActiveTierIndex(Math.max(0, Math.min(totalTiers - 1, idx)));
  }

  return (
    <div className="draft-board">
      {/* ── Top bar: Back | tier chips | Submit ── */}
      <div className="draft-controls">
        <button
          className="draft-nav-btn back"
          type="button"
          onClick={() => goTo(activeTierIndex - 1)}
          disabled={activeTierIndex === 0}
          aria-label="Previous tier"
        >
          ← Back
        </button>

        {/* Tier chips */}
        <div className="draft-tier-chips">
          {tiers.map((tier, idx) => {
            const sel = selections.find((s) => s.tierId === tier.id);
            const g = sel ? golferMap.get(sel.golferId) : null;
            const isActive = idx === activeTierIndex;
            const isPicked = !!g;

            return (
              <button
                key={tier.id}
                className={`draft-tier-chip${isActive ? " active" : ""}${isPicked && !isActive ? " picked" : ""}${!isPicked && !isActive ? " empty" : ""}`}
                onClick={() => goTo(idx)}
                type="button"
                title={g ? g.name : `Pick ${tier.label}`}
              >
                <span className="draft-tier-chip-label">{tier.label}</span>
                <span className={`draft-tier-chip-golfer${!isPicked ? " unpicked" : ""}`}>
                  {g ? g.name : "SELECT"}
                </span>
              </button>
            );
          })}
        </div>

        <button
          className={`draft-nav-btn${submitActive ? " submit" : " submit-disabled"}`}
          type="button"
          onClick={submitActive ? onSubmit : undefined}
          disabled={!submitActive}
          title={!isValid ? `${totalTiers - selections.length} more picks needed` : "Submit your team"}
        >
          {submitLabel}
        </button>
      </div>

      {/* ── Selection chip — current pick or prompt ── */}
      <div className={`draft-selection-chip${selectedGolfer ? " picked" : " empty"}`}>
        {selectedGolfer ? (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="draft-selection-chip-name">{selectedGolfer.name}</span>
              <span className="draft-selection-chip-meta">
                {oddsLabel(selectedGolfer)}
                {probLabel(selectedGolfer) && ` · ${probLabel(selectedGolfer)} win probability`}
              </span>
            </div>
            <span className="draft-selection-chip-check" aria-hidden="true">✓</span>
          </>
        ) : (
          <span style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
            Pick a golfer for {activeTier.label} below ↓
          </span>
        )}
      </div>

      {/* ── Golfer grid — 3 columns, compact ── */}
      <div className="golfer-option-grid">
        {activeTier.golferIds.map((gid) => {
          const g = golferMap.get(gid);
          if (!g) return null;
          const isSelected = activeGolferId === g.id;
          return (
            <button
              key={g.id}
              className={`golfer-option${isSelected ? " selected" : ""}`}
              onClick={() => handlePickGolfer(activeTier.id, g.id)}
              type="button"
            >
              {isSelected && (
                <span className="golfer-option-check" aria-hidden="true">✓</span>
              )}
              <span className="golfer-option-name">{g.name}</span>
              <div className="golfer-option-meta">
                <span>{oddsLabel(g)}</span>
                {probLabel(g) && (
                  <>
                    <span className="golfer-option-sep">·</span>
                    <span className="golfer-option-prob">{probLabel(g)}</span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Status line ── */}
      {(draftMessage || (!isValid && selections.length > 0)) && (
        <p className={`small${draftMessage?.includes("✓") || draftMessage?.includes("saved") ? "" : " muted"}`}
          style={{ marginTop: 4, textAlign: "center" }}>
          {draftMessage ?? `${selections.length} of ${totalTiers} picks made`}
        </p>
      )}
    </div>
  );
}
