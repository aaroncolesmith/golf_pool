"use client";

import { useState } from "react";
import { Golfer, Pool, TeamSelection, Tier } from "@/lib/types";

type Props = {
  pool: Pool;
  golferMap: Map<string, Golfer>;
  selections: TeamSelection[];
  onSelectionChange: (tierId: string, golferId: string) => void;
  onSave: (submit: boolean) => void;
  draftMessage: string | null;
  existingSubmittedAt: string | null;
  isLocked: boolean;
  isValid: boolean;
  validationError: string | null;
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
  onSave,
  draftMessage,
  existingSubmittedAt,
  isLocked,
  isValid,
  validationError,
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

  const activeSelection = selections.find((s) => s.tierId === activeTier.id)?.golferId ?? null;
  const selectedGolfer = activeSelection ? golferMap.get(activeSelection) : null;
  const allPicked = selections.length === totalTiers;
  const isLastTier = activeTierIndex === totalTiers - 1;

  function handlePickGolfer(tierId: string, golferId: string) {
    // If same golfer clicked again, deselect
    const current = selections.find((s) => s.tierId === tierId)?.golferId;
    if (current === golferId) return;
    onSelectionChange(tierId, golferId);
    // Auto-advance after a short delay so the selection highlight is visible
    if (!isLastTier) {
      setTimeout(() => setActiveTierIndex((i) => i + 1), 260);
    }
  }

  function goTo(idx: number) {
    setActiveTierIndex(Math.max(0, Math.min(totalTiers - 1, idx)));
  }

  return (
    <div className="draft-board">
      {/* ── Top controls: Back | progress + tier label | Next ── */}
      <div className="draft-controls">
        <button
          className="draft-nav-btn back"
          type="button"
          onClick={() => goTo(activeTierIndex - 1)}
          disabled={activeTierIndex === 0}
        >
          ← Back
        </button>

        <div className="draft-controls-center">
          <span className="draft-tier-label">{activeTier.label}</span>
          <div className="draft-progress">
            {tiers.map((tier, idx) => {
              const isPicked = selections.some((s) => s.tierId === tier.id);
              const isActive = idx === activeTierIndex;
              return (
                <button
                  key={tier.id}
                  className={`draft-progress-dot${isPicked ? " done" : isActive ? " active" : ""}`}
                  onClick={() => goTo(idx)}
                  type="button"
                  title={tier.label}
                  aria-label={`Go to ${tier.label}`}
                />
              );
            })}
          </div>
          <span className="draft-tier-step">{activeTierIndex + 1} of {totalTiers}</span>
        </div>

        {isLastTier ? (
          <button
            className="draft-nav-btn submit"
            type="button"
            onClick={() => onSave(true)}
            disabled={!isValid}
            title={isValid ? "Submit your picks" : (validationError ?? "Complete all tiers first")}
          >
            Submit ✓
          </button>
        ) : (
          <button
            className="draft-nav-btn next"
            type="button"
            onClick={() => goTo(activeTierIndex + 1)}
          >
            Next →
          </button>
        )}
      </div>

      {/* ── Selection chip — shows current pick or prompt ── */}
      <div className={`draft-selection-chip ${selectedGolfer ? "picked" : "empty"}`}>
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
          <>
            <span style={{ fontSize: "0.88rem" }}>Pick a golfer for {activeTier.label} ↓</span>
            <span style={{ fontSize: "1rem" }}>⬇</span>
          </>
        )}
      </div>

      {/* ── Golfer card grid — 3 columns, compact ── */}
      <div className="golfer-option-grid">
        {activeTier.golferIds.map((gid) => {
          const g = golferMap.get(gid);
          if (!g) return null;
          const isSelected = activeSelection === g.id;
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

      {/* ── Picks summary — all tiers, clickable to jump ── */}
      <div>
        <p style={{
          fontSize: "0.72rem",
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--muted)",
          marginBottom: 0,
        }}>
          Your team
        </p>
        <div className="draft-summary">
          {tiers.map((tier, idx) => {
            const sel = selections.find((s) => s.tierId === tier.id);
            const g = sel ? golferMap.get(sel.golferId) : null;
            const isActiveTier = idx === activeTierIndex;
            return (
              <div
                key={tier.id}
                className={`draft-summary-row${isActiveTier ? " active-tier" : ""}`}
                onClick={() => goTo(idx)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && goTo(idx)}
              >
                <div className="draft-summary-left">
                  <span className="draft-summary-tier">{tier.label}</span>
                  {g ? (
                    <span className="draft-summary-golfer">{g.name}</span>
                  ) : (
                    <span className="muted small">Not picked yet</span>
                  )}
                </div>
                <span className="draft-summary-edit">{isActiveTier ? "current" : g ? "edit" : "pick →"}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Action footer ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {draftMessage && (
            <p className={`small${draftMessage.includes("✓") || draftMessage.includes("saved") ? "" : " muted"}`}>
              {draftMessage}
            </p>
          )}
          {!draftMessage && validationError && (
            <p className="muted small">{validationError}</p>
          )}
          {!draftMessage && existingSubmittedAt && (
            <p className="muted small">Submitted — update anytime before lock.</p>
          )}
          {!draftMessage && !existingSubmittedAt && selections.length > 0 && !allPicked && (
            <p className="muted small">{selections.length} of {totalTiers} tiers picked.</p>
          )}
        </div>

        {selections.length > 0 && (
          <button
            className="secondary-button small-button"
            type="button"
            onClick={() => onSave(false)}
            style={{ flexShrink: 0 }}
          >
            Save draft
          </button>
        )}
      </div>
    </div>
  );
}
