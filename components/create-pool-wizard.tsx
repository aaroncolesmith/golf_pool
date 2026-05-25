"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAppState } from "@/lib/store";
import { Golfer, Tier, Tournament } from "@/lib/types";
import { formatEasternDateTimeShort } from "@/lib/utils";

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

function buildTiersFromBoundaries(golfers: Golfer[], boundaries: number[]): Tier[] {
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

function createInitialTiers(golfers: Golfer[]): Tier[] {
  return buildTiersFromBoundaries(golfers, buildDefaultBoundaries(golfers.length));
}

export function CreatePoolWizard() {
  const router = useRouter();
  const { state, currentUser, createPool, importTournamentFeed } = useAppState();
  const [poolName, setPoolName] = useState("");
  const [poolDescription, setPoolDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [poolMessage, setPoolMessage] = useState<string | null>(null);
  const [importOptions, setImportOptions] = useState<UpcomingTournamentOption[]>([]);
  const [selectedImportSlug, setSelectedImportSlug] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isLoadingImports, setIsLoadingImports] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

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

        if (cancelled) return;

        const tournaments = payload.tournaments ?? [];
        setImportOptions(tournaments);
        setSelectedImportSlug((current) => current || tournaments[0]?.slug || "");
      } catch (error) {
        if (!cancelled) {
          setImportMessage(error instanceof Error ? error.message : "Unable to load DraftKings tournaments.");
        }
      } finally {
        if (!cancelled) setIsLoadingImports(false);
      }
    }

    void loadImportOptions();
    return () => { cancelled = true; };
  }, []);

  async function handleCreatePool() {
    if (!poolName.trim()) {
      setPoolMessage("Add a pool name to continue.");
      return;
    }
    if (!selectedImportSlug) {
      setPoolMessage("Choose a tournament to continue.");
      return;
    }

    setIsCreating(true);
    setPoolMessage(null);

    try {
      const selectedImport = importOptions.find((o) => o.slug === selectedImportSlug);
      const tournamentId = `dk-${selectedImportSlug}`;
      const cachedTournament = state.tournaments.find((t) => t.id === tournamentId);
      const cachedGolfers = state.golfers.filter((g) => g.tournamentId === tournamentId);

      let tournament: Tournament;
      let golfers: Golfer[];

      if (cachedTournament && cachedGolfers.length > 0) {
        tournament = cachedTournament;
        golfers = cachedGolfers;
      } else {
        const params = new URLSearchParams();
        if (selectedImport?.leagueId) params.set("leagueId", selectedImport.leagueId);
        const response = await fetch(
          `/api/draftkings/tournament/${selectedImportSlug}${params.size ? `?${params.toString()}` : ""}`,
        );
        const payload = (await response.json()) as Partial<TournamentImportResponse> & { error?: string };

        if (!response.ok || !payload.tournament || !payload.golfers) {
          throw new Error(payload.error ?? "Unable to import the selected tournament.");
        }

        await importTournamentFeed(payload.tournament, payload.golfers);
        tournament = payload.tournament;
        golfers = payload.golfers;
      }

      const tiers = createInitialTiers(golfers);
      const pool = await createPool({
        name: poolName.trim(),
        tournamentId: tournament.id,
        lockAt: tournament.startDate,
        tiers,
        isPublic,
        description: poolDescription,
      });

      if (!pool) throw new Error("Unable to create pool.");
      router.push(`/pools/${pool.id}`);
    } catch (error) {
      setPoolMessage(error instanceof Error ? error.message : "Unable to create pool.");
    } finally {
      setIsCreating(false);
    }
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

  const selectedImportOption = importOptions.find((t) => t.slug === selectedImportSlug) ?? null;

  return (
    <main className="dashboard-shell">
      <article className="panel create-panel create-page-panel">
        <div className="create-layout step-one-layout">
          <div className="create-main create-main-card">
            <div className="tier-builder-header">
              <div>
                <p className="panel-kicker">Commissioner</p>
                <h3>Create New Pool</h3>
              </div>
              <p className="muted small">
                Choose a tournament and give your pool a name. You&apos;ll set up tiers after creation.
              </p>
            </div>

            <div className="wizard-stage-card wizard-intake-card">
              <label className="field">
                <span>Pool name</span>
                <input
                  value={poolName}
                  onChange={(event) => setPoolName(event.target.value)}
                  placeholder="e.g. Augusta Masters Challenge 2026"
                  disabled={isCreating}
                />
              </label>
              <label className="field">
                <span>Select tournament</span>
                <select
                  value={selectedImportSlug}
                  onChange={(event) => setSelectedImportSlug(event.target.value)}
                  disabled={isLoadingImports || isCreating || importOptions.length === 0}
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

              <label className="field">
                <span>Description <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span></span>
                <textarea
                  value={poolDescription}
                  onChange={(e) => setPoolDescription(e.target.value)}
                  placeholder="Add rules, buy-in info, or any notes for your pool members..."
                  rows={3}
                  disabled={isCreating}
                  style={{ resize: "vertical", minHeight: 72 }}
                />
              </label>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Visibility</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className={isPublic ? "secondary-button small-button" : "primary-button small-button"}
                    onClick={() => setIsPublic(false)}
                    disabled={isCreating}
                  >
                    Private
                  </button>
                  <button
                    type="button"
                    className={isPublic ? "primary-button small-button" : "secondary-button small-button"}
                    onClick={() => setIsPublic(true)}
                    disabled={isCreating}
                  >
                    Public
                  </button>
                </div>
                <p className="muted small" style={{ margin: 0 }}>
                  {isPublic
                    ? "Anyone on GolfPool can discover and join this pool."
                    : "Only people with the join code or link can join."}
                </p>
              </div>

              <button
                className="primary-button"
                type="button"
                onClick={handleCreatePool}
                disabled={isLoadingImports || isCreating}
              >
                {isCreating ? "Creating pool…" : "Create Pool"}
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
          </div>
        </div>
      </article>
    </main>
  );
}
