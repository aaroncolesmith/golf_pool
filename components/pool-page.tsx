"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isPoolLocked, poolSharePath, validateSelections } from "@/lib/pool";
import { buildLeaderboard } from "@/lib/scoring";
import { useAppState } from "@/lib/store";
import { TeamSelection } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export function PoolPage({ poolId }: { poolId: string }) {
  const { state, currentUser, updatePoolTiers, saveEntry, inviteEmails } = useAppState();
  const pool = state.pools.find((candidate) => candidate.id === poolId);
  const tournament = state.tournaments.find((candidate) => candidate.id === pool?.tournamentId);
  const golfers = state.golfers.filter((candidate) => candidate.tournamentId === tournament?.id);
  const golferLookup = useMemo(() => new Map(golfers.map((golfer) => [golfer.id, golfer])), [golfers]);
  const existingEntry = currentUser
    ? state.entries.find((entry) => entry.poolId === poolId && entry.userId === currentUser.id)
    : null;
  const leaderboard = pool ? buildLeaderboard(state, pool) : [];
  const [selections, setSelections] = useState<TeamSelection[]>(existingEntry?.selections ?? []);
  const [inviteInput, setInviteInput] = useState("");
  const [draftMessage, setDraftMessage] = useState<string | null>(null);

  useEffect(() => {
    setSelections(existingEntry?.selections ?? []);
  }, [existingEntry]);

  if (!pool || !tournament) {
    return (
      <main className="centered-page">
        <div className="panel callback-panel">
          <h1>Pool not found</h1>
          <Link className="primary-button" href="/">
            Return home
          </Link>
        </div>
      </main>
    );
  }

  const currentPool = pool;
  const currentTournament = tournament;
  const memberUsers = state.users.filter((user) => currentPool.memberUserIds.includes(user.id));
  const validation = validateSelections(currentPool, selections);

  const isAdmin = currentUser?.id === currentPool.adminUserId;
  const isMember = currentUser ? currentPool.memberUserIds.includes(currentUser.id) : false;
  const isLocked = isPoolLocked(currentPool);

  function updateSelection(tierId: string, golferId: string) {
    setDraftMessage(null);
    setSelections((current) => {
      const withoutTier = current.filter((selection) => selection.tierId !== tierId);
      return [...withoutTier, { tierId, golferId }];
    });
  }

  function handleTierMove(golferId: string, nextTierId: string) {
    const nextTiers = currentPool.tiers.map((tier) => ({
      ...tier,
      golferIds: tier.golferIds.filter((id) => id !== golferId),
    }));
    const targetTier = nextTiers.find((tier) => tier.id === nextTierId);
    if (!targetTier) {
      return;
    }
    targetTier.golferIds = [...targetTier.golferIds, golferId];
    updatePoolTiers(currentPool.id, nextTiers);
  }

  async function handleInvite() {
    await inviteEmails(
      currentPool.id,
      inviteInput
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean),
    );
    setInviteInput("");
  }

  async function handleSave(submit: boolean) {
    if (submit && !validation.isValid) {
      setDraftMessage(validation.errors[0] ?? "Your entry is not ready to submit.");
      return;
    }

    const entry = await saveEntry(currentPool.id, selections, submit);
    setDraftMessage(entry ? (submit ? "Team submitted." : "Draft saved.") : "Unable to save your entry.");
  }

  return (
    <main className="page-shell">
      <section className="pool-header">
        <div>
          <p className="eyebrow">{currentTournament.name}</p>
          <h1>{currentPool.name}</h1>
          <p className="muted">
            {currentTournament.course} • Locks {formatDate(currentPool.lockAt)}
          </p>
        </div>
        <div className="stack-right">
          <span className="pill">Join code {currentPool.joinCode}</span>
          <Link className="secondary-button" href={poolSharePath(currentPool)}>
            Share join link
          </Link>
        </div>
      </section>

      <section className="grid pool-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Draft Board</h2>
            <span className="panel-kicker">Pick one golfer per tier</span>
          </div>
          {!currentUser ? (
            <p className="muted">Sign in to join the pool and submit a team.</p>
          ) : !isMember ? (
            <p className="muted">Join this pool before making your picks.</p>
          ) : (
            <div className="stack">
              <div className="notice">
                <p>{isLocked ? "The pool is locked. Picks are now read-only." : `${selections.length}/6 golfers selected.`}</p>
                {!validation.isValid && selections.length > 0 ? <p className="muted">{validation.errors[0]}</p> : null}
              </div>
              {currentPool.tiers.map((tier) => (
                <label className="field" key={tier.id}>
                  <span>{tier.label}</span>
                  <select
                    value={selections.find((selection) => selection.tierId === tier.id)?.golferId ?? ""}
                    onChange={(event) => updateSelection(tier.id, event.target.value)}
                    disabled={isLocked}
                  >
                    <option value="">Select a golfer</option>
                    {tier.golferIds.map((golferId) => {
                      const golfer = golferLookup.get(golferId);
                      if (!golfer) {
                        return null;
                      }
                      return (
                        <option key={golfer.id} value={golfer.id}>
                          {golfer.name} • {golfer.oddsAmerican > 0 ? `+${golfer.oddsAmerican}` : golfer.oddsAmerican}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ))}
              <div className="draft-actions">
                <button
                  className="secondary-button"
                  onClick={() => handleSave(false)}
                  type="button"
                >
                  Save draft
                </button>
                <button
                  className="primary-button"
                  onClick={() => handleSave(true)}
                  disabled={!validation.isValid || isLocked}
                  type="button"
                >
                  Submit team
                </button>
              </div>
              {draftMessage ? <p className="muted">{draftMessage}</p> : null}
              {existingEntry?.submittedAt ? (
                <p className="muted">Submitted {formatDate(existingEntry.submittedAt)}</p>
              ) : (
                <p className="muted">Drafts can be saved before final submission.</p>
              )}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Leaderboard</h2>
            <span className="panel-kicker">Best four made-cut golfers count</span>
          </div>
          <div className="leaderboard">
            {leaderboard.map((row, index) => (
              <div className="leaderboard-row" key={row.entryId}>
                <div>
                  <p className="rankline">
                    <span>#{index + 1}</span> {row.teamName}
                  </p>
                  <p className="muted small">
                    {row.status === "eliminated"
                      ? "Eliminated: fewer than four golfers made the cut."
                      : row.countingGolfers.map((golfer) => `${golfer.name} (${golfer.currentScoreToPar})`).join(", ")}
                  </p>
                  {row.benchGolfers.length > 0 ? (
                    <p className="muted small">
                      Bench: {row.benchGolfers.map((golfer) => `${golfer.name} (${golfer.position})`).join(", ")}
                    </p>
                  ) : null}
                </div>
                <strong>{row.teamScore === null ? "E" : row.teamScore}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Contestants</h2>
            <span className="panel-kicker">Who is in and who has submitted</span>
          </div>
          <div className="stack">
            {memberUsers.map((member) => {
              const entry = state.entries.find((candidate) => candidate.poolId === currentPool.id && candidate.userId === member.id);
              return (
                <div className="list-link" key={member.id}>
                  <div>
                    <strong>{member.userName}</strong>
                    <p className="muted small">{member.email}</p>
                  </div>
                  <span className="pill">{entry?.submittedAt ? "Submitted" : entry ? "Draft saved" : "Not started"}</span>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel span-two">
          <div className="panel-header">
            <h2>Commissioner Controls</h2>
            <span className="panel-kicker">Adjust tiers and manage invites</span>
          </div>
          {isAdmin ? (
            <div className="stack">
              <div className="tier-preview">
                {currentPool.tiers.map((tier) => (
                  <div className="tier-card" key={tier.id}>
                    <p>{tier.label}</p>
                    {tier.golferIds.map((golferId) => {
                      const golfer = golferLookup.get(golferId);
                      if (!golfer) {
                        return null;
                      }
                      return (
                        <div className="tier-golfer commissioner-golfer" key={golfer.id}>
                          <div>
                            <strong>{golfer.name}</strong>
                            <span className="muted small">
                              {golfer.oddsAmerican > 0 ? `+${golfer.oddsAmerican}` : golfer.oddsAmerican} •{" "}
                              {(golfer.impliedProbability * 100).toFixed(1)}% implied
                            </span>
                          </div>
                          <select
                            value={tier.id}
                            onChange={(event) => handleTierMove(golfer.id, event.target.value)}
                          >
                            {currentPool.tiers.map((optionTier) => (
                              <option key={optionTier.id} value={optionTier.id}>
                                {optionTier.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <label className="field">
                <span>Add invite emails</span>
                <textarea rows={3} value={inviteInput} onChange={(event) => setInviteInput(event.target.value)} />
              </label>
              <button className="primary-button" onClick={handleInvite} type="button">
                Add invites
              </button>
              <p className="muted">Invited: {currentPool.invitedEmails.join(", ") || "None yet"}</p>
            </div>
          ) : (
            <p className="muted">Only the commissioner can change tiers and manage invites.</p>
          )}
        </article>
      </section>
    </main>
  );
}
