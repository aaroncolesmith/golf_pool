"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buildLeaderboard } from "@/lib/scoring";
import { magicLinkPreviewEnabled } from "@/lib/supabase/config";
import { useAppState } from "@/lib/store";
import { LeaderboardRow } from "@/lib/types";
import { cn } from "@/lib/utils";

type AuthNotice = {
  ok: boolean;
  title: string;
  message: string;
  detail?: string;
  href?: string | null;
};

function rankLabel(rows: LeaderboardRow[], userId: string) {
  const index = rows.findIndex((row) => row.userId === userId);
  return index === -1 ? null : `You are #${index + 1}`;
}

export function AppShell() {
  const router = useRouter();
  const { state, currentUser, logout, joinPool, register, login, isUsingSupabase } = useAppState();
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [dashboardMessage, setDashboardMessage] = useState<string | null>(null);

  async function handleAuth(formData: FormData) {
    const email = String(formData.get("email") ?? "");

    if (authMode === "register") {
      const userName = String(formData.get("userName") ?? "");
      const result = await register(userName, email);
      setAuthNotice({
        ok: result.ok,
        title: result.ok ? "Check your inbox" : "We couldn't send that link",
        message: result.message,
        detail: result.detail,
        href: result.previewHref,
      });
      return;
    }

    const result = await login(email);
    setAuthNotice({
      ok: result.ok,
      title: result.ok ? "Check your inbox" : "We couldn't send that link",
      message: result.message,
      detail: result.detail,
      href: result.previewHref,
    });
  }

  async function handleJoinPool() {
    const pool = await joinPool(joinCode);
    if (!pool) {
      setDashboardMessage(`No pool found for code ${joinCode}.`);
      return;
    }

    setDashboardMessage(`Joined ${pool.name}.`);
    setJoinCode("");
    router.push(`/pools/${pool.id}`);
  }

  if (!currentUser) {
    return (
      <main className="page-shell">
        <section className="auth-landing">
          <div className="auth-brand">
            <p className="eyebrow">Golf Pool Weekly</p>
            <h1>Build weekly PGA pools without spreadsheet chaos.</h1>
            <p className="hero-text">
              Import the field, configure the tiers, and let your group draft in a clean weekly pool flow.
            </p>
            <div className="hero-actions">
              <span className="pill accent">Magic link auth</span>
              <span className="pill">DraftKings odds import</span>
              <span className="pill">Tier-based picks</span>
            </div>
          </div>

          <article className="auth-card panel">
            <div className="panel-header">
              <h2>Sign In</h2>
              <span className="panel-kicker">Email access</span>
            </div>
            <div className="tabs">
              <button
                className={cn("tab", authMode === "register" && "active")}
                type="button"
                onClick={() => {
                  setAuthMode("register");
                  setAuthNotice(null);
                }}
              >
                Register
              </button>
              <button
                className={cn("tab", authMode === "login" && "active")}
                type="button"
                onClick={() => {
                  setAuthMode("login");
                  setAuthNotice(null);
                }}
              >
                Log in
              </button>
            </div>
            <form action={handleAuth} className="stack">
              {authMode === "register" ? (
                <label className="field">
                  <span>User name</span>
                  <input name="userName" placeholder="Your pool nickname" required />
                </label>
              ) : null}
              <label className="field">
                <span>Email</span>
                <input name="email" type="email" placeholder="you@example.com" required />
              </label>
              <button className="primary-button" type="submit">
                {authMode === "register" ? "Create account" : "Email me a sign-in link"}
              </button>
            </form>
            {authNotice ? (
              <div className={cn("notice", authNotice.ok ? "notice-success" : "notice-error")}>
                <strong>{authNotice.title}</strong>
                <p>{authNotice.message}</p>
                {authNotice.detail ? <p className="muted small">{authNotice.detail}</p> : null}
                {!isUsingSupabase && magicLinkPreviewEnabled && authNotice.href ? <Link href={authNotice.href}>Open preview link</Link> : null}
              </div>
            ) : (
              <div className="auth-footnote">
                <p className="muted">
                  {isUsingSupabase
                    ? "We’ll email you a secure one-time link. No password required."
                    : magicLinkPreviewEnabled
                      ? "Preview mode is enabled for this environment so you can test the email-link flow locally."
                      : "Email delivery is not configured for this environment yet."}
                </p>
              </div>
            )}
          </article>
        </section>
      </main>
    );
  }

  const poolsForUser = state.pools.filter((pool) => pool.memberUserIds.includes(currentUser.id));

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

      <section className="home-hero panel">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Manage your active golf pools and tournaments.</p>
        </div>
        <div className="dashboard-actions">
          <Link className="primary-button" href="/create">
            Create New Pool
          </Link>
          <button className="secondary-button" type="button" onClick={() => setIsJoinOpen((current) => !current)}>
            Join a Pool
          </button>
        </div>
      </section>

      {isJoinOpen ? (
        <section className="join-strip panel">
          <div className="join-inline">
            <input
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              placeholder="Enter join code"
            />
            <button className="primary-button" type="button" onClick={handleJoinPool}>
              Join pool
            </button>
          </div>
          {dashboardMessage ? <p className="muted small">{dashboardMessage}</p> : null}
        </section>
      ) : null}

      <section className="dashboard-grid home-grid">
        <article className="panel dashboard-table-panel">
          <div className="dashboard-section-head">
            <h2>My Pools</h2>
            <span className="panel-kicker">{poolsForUser.length} active entries</span>
          </div>
          {poolsForUser.length === 0 ? (
            <div className="empty-state">
              <p>No pools yet.</p>
              <p className="muted">Use the create button to launch the commissioner wizard, or join a pool with a code.</p>
            </div>
          ) : (
            <div className="pool-table">
              <div className="pool-table-head">
                <span>Pool Name</span>
                <span>Tournament</span>
                <span>Status</span>
                <span>Rank</span>
                <span>Total Score</span>
              </div>
              {poolsForUser.map((pool) => {
                const tournament = state.tournaments.find((candidate) => candidate.id === pool.tournamentId);
                const fullLeaderboard = buildLeaderboard(state, pool);
                const rank = rankLabel(fullLeaderboard, currentUser.id);
                const myRow = fullLeaderboard.find((row) => row.userId === currentUser.id) ?? null;
                const statusLabel =
                  tournament?.status === "finished"
                    ? "Completed"
                    : tournament?.status === "in_progress"
                      ? "In Progress"
                      : "Not Started";
                const statusClass =
                  tournament?.status === "finished"
                    ? "completed"
                    : tournament?.status === "in_progress"
                      ? "live"
                      : "pending";

                return (
                  <Link className="pool-table-row" href={`/pools/${pool.id}`} key={pool.id}>
                    <span className="pool-table-primary">{pool.name}</span>
                    <span className="muted">{tournament?.name ?? "Tournament pending"}</span>
                    <span className={cn("status-pill", statusClass)}>{statusLabel}</span>
                    <span>{rank ? rank.replace("You are ", "") : "—"}</span>
                    <strong className={cn("score-cell", myRow?.teamScore !== null && (myRow?.teamScore ?? 0) < 0 && "negative-score")}>
                      {myRow?.teamScore === null || myRow?.teamScore === undefined ? "E" : myRow.teamScore}
                    </strong>
                  </Link>
                );
              })}
              <div className="pool-table-footer">
                <span>View all pools</span>
                <span className="muted small">Active this week: {poolsForUser.length}</span>
              </div>
            </div>
          )}
        </article>
      </section>

      <footer className="dashboard-footer">
        <span>&copy; 2026 GolfPool. All rights reserved.</span>
        <div className="dashboard-footer-links">
          <span>Terms</span>
          <span>Privacy</span>
          <button className="footer-link-button" onClick={logout} type="button">
            Log out
          </button>
        </div>
      </footer>
    </main>
  );
}
