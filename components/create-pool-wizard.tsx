"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "@/lib/store";
import { Golfer, Tier, Tournament } from "@/lib/types";
import { cn, formatDate, formatEasternDateTimeShort } from "@/lib/utils";

type UpcomingTournamentOption = {
  id: string;
  leagueId: string;
  slug: string;
  name: string;
  startDate: string | null;
  url: string;
  oddsUrl: string;
};

type TournamentImportResponse = {
  tournament: Tournament;
  golfers: Golfer[];
  oddsSourceUrl: string;
};

const DEFAULT_TIER_SPLITS = [0.05, 0.1, 0.1, 0.15, 0.15];

function useTournamentGolfers(tournamentId?: string) {
  const { state } = useAppState();
  return useMemo(
    () => state.golfers.filter((golfer) => golfer.tournamentId === tournamentId),
    [state.golfers, tournamentId],
  );
}

function tierOptions(tier: Tier, tournamentGolfers: Golfer[]) {
  return tier.golferIds
    .map((golferId) => tournamentGolfers.find((golfer) => golfer.id === golferId))
    .filter((golfer): golfer is Golfer => Boolean(golfer));
}

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

function createInitialTiers(golfers: Golfer[]) {
  return buildTiersFromBoundaries(golfers, buildDefaultBoundaries(golfers.length));
}

function buildTiersFromBoundaries(golfers: Golfer[], boundaries: number[]) {
  const ordered = [...golfers].sort((a, b) => b.impliedProbability - a.impliedProbability);
  const slices = [...boundaries, ordered.length];
  let start = 0;

  return slices.map((end, index) => {
    const golferIds = ordered.slice(start, end).map((golfer) => golfer.id);
    start = end;

    return {
      id: `tier-${index + 1}`,
      label: `Tier ${index + 1}`,
      golferIds,
    };
  });
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

export function CreatePoolWizard() {
  const router = useRouter();
  const { state, currentUser, createPool, inviteEmails, importTournamentFeed } = useAppState();
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [selectedTournamentId, setSelectedTournamentId] = useState(state.tournaments[0]?.id ?? "");
  const [draftTiers, setDraftTiers] = useState<Tier[]>([]);
  const [poolName, setPoolName] = useState("");
  const [inviteInput, setInviteInput] = useState("alex@example.com,morgan@example.com");
  const [poolMessage, setPoolMessage] = useState<string | null>(null);
  const [importOptions, setImportOptions] = useState<UpcomingTournamentOption[]>([]);
  const [selectedImportSlug, setSelectedImportSlug] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isLoadingImports, setIsLoadingImports] = useState(false);
  const [isImportingTournament, setIsImportingTournament] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);

  const selectedTournament = state.tournaments.find((tournament) => tournament.id === selectedTournamentId) ?? state.tournaments[0];
  const tournamentGolfers = useTournamentGolfers(selectedTournament?.id);
  const selectedImportOption = importOptions.find((tournament) => tournament.slug === selectedImportSlug) ?? null;
  const orderedGolfers = useMemo(
    () => [...tournamentGolfers].sort((a, b) => b.impliedProbability - a.impliedProbability),
    [tournamentGolfers],
  );
  const tierBoundaries = useMemo(() => getTierBoundaries(draftTiers), [draftTiers]);

  useEffect(() => {
    if (!state.tournaments.some((tournament) => tournament.id === selectedTournamentId)) {
      setSelectedTournamentId(state.tournaments[0]?.id ?? "");
    }
  }, [selectedTournamentId, state.tournaments]);

  useEffect(() => {
    setDraftTiers(createInitialTiers(tournamentGolfers));
  }, [tournamentGolfers]);

  useEffect(() => {
    let cancelled = false;

    async function loadImportOptions() {
      setIsLoadingImports(true);
      setImportMessage(null);

      try {
        const response = await fetch("/api/draftkings/upcoming");
        const payload = (await response.json()) as { tournaments?: UpcomingTournamentOption[]; error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load DraftKings tournaments.");
        }

        if (cancelled) {
          return;
        }

        const tournaments = payload.tournaments ?? [];
        setImportOptions(tournaments);
        setSelectedImportSlug((current) => current || tournaments[0]?.slug || "");
      } catch (error) {
        if (!cancelled) {
          setImportMessage(error instanceof Error ? error.message : "Unable to load DraftKings tournaments.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingImports(false);
        }
      }
    }

    void loadImportOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadSelectedTournament() {
    if (!selectedImportSlug) {
      return false;
    }

    const selectedImport = importOptions.find((option) => option.slug === selectedImportSlug);
    const existingTournamentId = selectedImport ? `dk-${selectedImport.slug}` : "";
    const existingTournament = state.tournaments.find((tournament) => tournament.id === existingTournamentId);
    const existingGolfers = state.golfers.filter((golfer) => golfer.tournamentId === existingTournamentId);

    if (existingTournament && existingGolfers.length > 0) {
      setSelectedTournamentId(existingTournament.id);
      if (!poolName.trim()) {
        setPoolName(`${existingTournament.name} Pool`);
      }
      return true;
    }

    setIsImportingTournament(true);
    setImportMessage(null);

    try {
      const params = new URLSearchParams();
      if (selectedImport?.leagueId) {
        params.set("leagueId", selectedImport.leagueId);
      }

      const response = await fetch(
        `/api/draftkings/tournament/${selectedImportSlug}${params.size ? `?${params.toString()}` : ""}`,
      );
      const payload = (await response.json()) as Partial<TournamentImportResponse> & { error?: string };

      if (!response.ok || !payload.tournament || !payload.golfers) {
        throw new Error(payload.error ?? "Unable to import the selected tournament.");
      }

      await importTournamentFeed(payload.tournament, payload.golfers);
      setSelectedTournamentId(payload.tournament.id);
      if (!poolName.trim()) {
        setPoolName(`${payload.tournament.name} Pool`);
      }
      setImportMessage(null);
      return true;
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Unable to import the selected tournament.");
      return false;
    } finally {
      setIsImportingTournament(false);
    }
  }

  async function handleTournamentContinue() {
    if (!poolName.trim()) {
      setPoolMessage("Add a pool name to continue.");
      return;
    }

    if (!selectedImportSlug) {
      setPoolMessage("Choose a tournament to continue.");
      return;
    }

    setPoolMessage(null);
    const ok = await loadSelectedTournament();

    if (!ok) {
      return;
    }

    setCreateStep(2);
  }

  async function handleCreatePool() {
    if (!currentUser || !selectedTournament) {
      setPoolMessage("You need to be signed in and choose a tournament.");
      return;
    }

    setPoolMessage(null);

    try {
      const pool = await createPool({
        name: poolName,
        tournamentId: selectedTournament.id,
        lockAt: selectedTournament.startDate,
        tiers: draftTiers,
      });

      if (!pool) {
        setPoolMessage("Unable to create pool.");
        return;
      }

      if (inviteInput.trim()) {
        await inviteEmails(
          pool.id,
          inviteInput
            .split(",")
            .map((email) => email.trim())
            .filter(Boolean),
        );
      }

      router.push(`/pools/${pool.id}`);
    } catch (error) {
      setPoolMessage(error instanceof Error ? error.message : "Unable to create pool.");
    }
  }

  function handleBoundaryChange(boundaryIndex: number, nextValue: number) {
    const currentBoundaries = getTierBoundaries(draftTiers);
    const min = boundaryIndex === 0 ? 1 : currentBoundaries[boundaryIndex - 1] + 1;
    const max =
      boundaryIndex === currentBoundaries.length - 1
        ? orderedGolfers.length - 1
        : currentBoundaries[boundaryIndex + 1] - 1;
    const clampedValue = Math.max(min, Math.min(max, nextValue));
    const nextBoundaries = [...currentBoundaries];
    nextBoundaries[boundaryIndex] = clampedValue;
    setDraftTiers(buildTiersFromBoundaries(orderedGolfers, nextBoundaries));
  }

  function handleBoundaryPointerDown(boundaryIndex: number, clientX: number) {
    const rail = railRef.current;
    if (!rail || orderedGolfers.length === 0) {
      return;
    }

    const rect = rail.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const nextValue = Math.round(Math.max(0, Math.min(1, ratio)) * orderedGolfers.length);
    handleBoundaryChange(boundaryIndex, nextValue);
  }

  function startBoundaryDrag(boundaryIndex: number, event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();

    const onMove = (moveEvent: PointerEvent) => {
      handleBoundaryPointerDown(boundaryIndex, moveEvent.clientX);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    handleBoundaryPointerDown(boundaryIndex, event.clientX);
  }

  if (!currentUser) {
    return (
      <main className="dashboard-shell">
        <section className="panel">
          <div className="panel-header">
            <h2>Create Pool</h2>
            <span className="panel-kicker">Commissioner workflow</span>
          </div>
          <p className="muted">Sign in first to create a pool.</p>
          <Link className="primary-button" href="/">
            Return home
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <section className="dashboard-nav">
        <div className="brand-lockup">
          <strong>GolfPool</strong>
        </div>
        <div className="dashboard-actions">
          <span className="profile-badge" aria-label={currentUser.userName}>
            {currentUser.userName.slice(0, 1).toUpperCase()}
          </span>
        </div>
      </section>

      <article className={cn("panel create-panel create-page-panel", createStep === 2 && "create-panel-tier")}>
        <div className="create-steps create-progress">
          <div className="create-progress-row">
            <span className="create-progress-label active">Step {createStep} of 3</span>
            <span className="create-progress-label muted">
              {createStep === 1 ? "General Info" : createStep === 2 ? "Tiers" : "Review"}
            </span>
          </div>
          <div className="create-progress-track">
            <span className="create-progress-fill" style={{ width: createStep === 1 ? "33.333%" : createStep === 2 ? "66.666%" : "100%" }} />
          </div>
        </div>

        <div className={cn("create-layout", createStep === 1 && "step-one-layout", createStep === 2 && "step-two-layout")}>
          <div className={cn("create-sidebar stack", (createStep === 1 || createStep === 2) && "create-sidebar-hidden")}>
            {createStep === 2 ? (
              <>
                <div className="notice">
                  <p>Move golfers between tiers until the board feels right for your pool.</p>
                </div>
                <div className="wizard-stat">
                  <span className="summary-label">Tournament</span>
                  <strong>{selectedTournament?.name ?? "Not selected"}</strong>
                </div>
                <div className="wizard-stat">
                  <span className="summary-label">Field size</span>
                  <strong>{tournamentGolfers.length} golfers</strong>
                </div>
                <div className="wizard-stat">
                  <span className="summary-label">Tier count</span>
                  <strong>{draftTiers.length}</strong>
                </div>

                <div className="draft-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setDraftTiers(createInitialTiers(tournamentGolfers))}
                  >
                    Reset tiers
                  </button>
                  <button className="primary-button" type="button" onClick={() => setCreateStep(3)}>
                    Continue to details
                  </button>
                </div>
              </>
            ) : null}

            {createStep === 3 ? (
              <>
                <div className="notice">
                  <p>Name the pool, add invite emails, and publish it for your group.</p>
                </div>
                <label className="field">
                  <span>Pool name</span>
                  <input value={poolName} onChange={(event) => setPoolName(event.target.value)} />
                </label>

                <label className="field">
                  <span>Invite emails</span>
                  <textarea rows={4} value={inviteInput} onChange={(event) => setInviteInput(event.target.value)} />
                </label>

                <div className="wizard-summary">
                  <div className="wizard-stat">
                    <span className="summary-label">Tournament</span>
                    <strong>{selectedTournament?.name ?? "Not selected"}</strong>
                  </div>
                  <div className="wizard-stat">
                    <span className="summary-label">Lock time</span>
                    <strong>{selectedTournament ? formatDate(selectedTournament.startDate) : "TBD"}</strong>
                  </div>
                  <div className="wizard-stat">
                    <span className="summary-label">Tiers</span>
                    <strong>{draftTiers.length}</strong>
                  </div>
                </div>

                <div className="draft-actions">
                  <button className="secondary-button" type="button" onClick={() => setCreateStep(2)}>
                    Back to tiers
                  </button>
                  <button className="primary-button" type="button" onClick={handleCreatePool}>
                    Create pool
                  </button>
                </div>
              </>
            ) : null}

            {createStep !== 1 && importMessage ? <p className="muted small">{importMessage}</p> : null}
            {createStep !== 1 && poolMessage ? <div className="notice"><p>{poolMessage}</p></div> : null}
          </div>

          <div className={cn("create-main", createStep === 1 && "create-main-card", createStep === 2 && "create-main-tier")}>
            {createStep !== 2 ? (
              <div className="tier-builder-header">
                <div>
                  <p className="panel-kicker">
                    {createStep === 1 ? "Step 1" : "Step 3"}
                  </p>
                  <h3>{createStep === 1 ? "Create New Pool" : "Review before creation"}</h3>
                </div>
                <p className="muted small">
                  {createStep === 1
                    ? "Let's start with the basics of your golf tournament pool."
                    : "Final check: confirm the tournament, tier count, and pool details before publishing."}
                </p>
              </div>
            ) : null}

            {createStep === 1 ? (
              <div className="wizard-stage-card wizard-intake-card">
                <label className="field">
                  <span>Pool name</span>
                  <input
                    value={poolName}
                    onChange={(event) => setPoolName(event.target.value)}
                    placeholder="e.g. Augusta Masters Challenge 2026"
                  />
                </label>
                <label className="field">
                  <span>Select tournament</span>
                  <select
                    value={selectedImportSlug}
                    onChange={(event) => setSelectedImportSlug(event.target.value)}
                    disabled={isLoadingImports || isImportingTournament || importOptions.length === 0}
                  >
                    <option value="">
                      {isLoadingImports ? "Loading tournaments..." : "Choose a tournament..."}
                    </option>
                    {importOptions.map((tournament) => (
                      <option key={tournament.slug} value={tournament.slug}>
                        {tournament.name}
                        {tournament.startDate ? ` | ${formatEasternDateTimeShort(tournament.startDate)}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="primary-button" type="button" onClick={handleTournamentContinue} disabled={isLoadingImports || isImportingTournament}>
                  {isImportingTournament ? "Loading tournament..." : "Next"}
                </button>
                <Link className="wizard-cancel-link" href="/">
                  Cancel and go back
                </Link>
                {selectedImportOption ? (
                  <p className="wizard-intake-copy">
                    {selectedImportOption.name}
                    {selectedImportOption.startDate ? ` | ${formatEasternDateTimeShort(selectedImportOption.startDate)}` : ""}
                  </p>
                ) : null}
                {importMessage ? <p className="muted small">{importMessage}</p> : null}
                {poolMessage ? <div className="notice"><p>{poolMessage}</p></div> : null}
              </div>
            ) : null}

            {createStep === 2 ? (
              <div className="wizard-stage-card tier-editor-shell">
                <div className="tier-editor-card">
                  <div className="tier-toolbar">
                    <h2>Draft Tier Configuration</h2>
                    <div className="draft-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setDraftTiers(createInitialTiers(tournamentGolfers))}
                      >
                        Reset Tiers
                      </button>
                      <button className="primary-button" type="button" onClick={() => setCreateStep(3)}>
                        Save &amp; Next
                      </button>
                    </div>
                  </div>

                  <div className="tier-slider-panel">
                    <div className="tier-slider-meta">
                      {draftTiers.map((tier) => (
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
                          aria-label={`Adjust ${draftTiers[index].label} boundary`}
                          className="tier-slider-handle"
                          key={draftTiers[index].id}
                          onPointerDown={(event) => startBoundaryDrag(index, event)}
                          style={{ left: `calc(${(boundary / orderedGolfers.length) * 100}% - 8px)` }}
                          type="button"
                        />
                      ))}
                    </div>
                  </div>

                  <div className="tier-board full-tier-board">
                    {draftTiers.map((tier) => (
                      <div className="tier-column expanded-tier-column" key={tier.id}>
                        <div className="tier-column-head">
                          <p>{tier.label}</p>
                          <span>{tier.golferIds.length} pl.</span>
                        </div>
                        <div className="tier-column-list">
                          {tierOptions(tier, orderedGolfers).map((golfer) => (
                            <div className="tier-player-row" key={golfer.id}>
                              <strong>{golfer.name}</strong>
                              <div className="tier-player-meta">
                                <span>{golfer.oddsAmerican > 0 ? `+${golfer.oddsAmerican}` : golfer.oddsAmerican}</span>
                                <span>{(golfer.impliedProbability * 100).toFixed(1)}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {createStep === 3 ? (
              <div className="wizard-stage-card">
                <div className="wizard-review-grid">
                  <div className="wizard-review-block">
                    <span className="summary-label">Tournament</span>
                    <strong>{selectedTournament?.name ?? "Not selected"}</strong>
                    <p className="muted small">
                      {selectedTournament ? formatDate(selectedTournament.startDate) : "Tournament still needs to be selected."}
                    </p>
                  </div>
                  <div className="wizard-review-block">
                    <span className="summary-label">Tier setup</span>
                    <strong>{draftTiers.length} tiers ready</strong>
                    <p className="muted small">
                      {draftTiers.reduce((count, tier) => count + tier.golferIds.length, 0)} golfers distributed across the board.
                    </p>
                  </div>
                  <div className="wizard-review-block">
                    <span className="summary-label">Pool details</span>
                    <strong>{poolName || "Untitled pool"}</strong>
                    <p className="muted small">
                      {inviteInput.trim() ? inviteInput.split(",").filter(Boolean).length : 0} invite emails queued.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </article>
    </main>
  );
}
