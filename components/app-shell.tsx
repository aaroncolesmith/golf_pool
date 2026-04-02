"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buildLeaderboard } from "@/lib/scoring";
import { useAppState } from "@/lib/store";
import { LeaderboardRow } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rankLabel(rows: LeaderboardRow[], userId: string): string | null {
  const index = rows.findIndex((row) => row.userId === userId);
  return index === -1 ? null : `#${index + 1}`;
}

function scoreLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return "E";
  if (score === 0) return "E";
  return score > 0 ? `+${score}` : `${score}`;
}

function scoreBadgeClass(score: number | null | undefined): string {
  if (score === null || score === undefined || score === 0) return "score-badge even";
  return score < 0 ? "score-badge under" : "score-badge over";
}

type AuthNotice = {
  ok: boolean;
  title: string;
  message: string;
  detail?: string;
};

// ---------------------------------------------------------------------------
// Loading skeleton for pool cards
// ---------------------------------------------------------------------------

function PoolCardSkeleton() {
  return (
    <div style={{ padding: "16px 20px", borderBottom: "1px solid #f3f5f8" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="skeleton-line short" style={{ height: 10 }} />
        <div className="skeleton-line medium tall" />
        <div className="skeleton-line" style={{ width: "55%", height: 10 }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth page
// ---------------------------------------------------------------------------

function AuthPage() {
  const { register, login } = useAppState();
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleAuth(formData: FormData) {
    const email = String(formData.get("email") ?? "");
    setIsPending(true);
    setAuthNotice(null);

    try {
      if (authMode === "register") {
        const userName = String(formData.get("userName") ?? "");
        const result = await register(userName, email);
        setAuthNotice({
          ok: result.ok,
          title: result.ok ? "Check your inbox" : "Couldn't send that link",
          message: result.message,
          detail: result.detail,
        });
      } else {
        const result = await login(email);
        setAuthNotice({
          ok: result.ok,
          title: result.ok ? "Check your inbox" : "Couldn't send that link",
          message: result.message,
          detail: result.detail,
        });
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="auth-landing">
        <div className="auth-brand">
          <p className="eyebrow">Golf Pool</p>
          <h1>Build weekly PGA pools without spreadsheet chaos.</h1>
          <p className="hero-text" style={{ marginTop: 16, fontSize: "1.05rem", lineHeight: 1.6 }}>
            Import the field, configure tiers, and let your group draft in a clean weekly pool flow.
          </p>
          <div className="hero-actions" style={{ marginTop: 20, gap: 8, flexWrap: "wrap" }}>
            <span className="pill accent">Magic link auth</span>
            <span className="pill">DraftKings odds import</span>
            <span className="pill">Tier-based picks</span>
            <span className="pill">Live ESPN scores</span>
          </div>
        </div>

        <article className="auth-card panel">
          <div className="panel-header" style={{ marginBottom: 16 }}>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 800, letterSpacing: "-0.03em" }}>
              Sign in
            </h2>
            <span className="panel-kicker">No password needed</span>
          </div>

          <div className="tabs" style={{ marginBottom: 16 }}>
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
            {authMode === "register" && (
              <label className="field">
                <span>Your name</span>
                <input name="userName" placeholder="Pool nickname" required />
              </label>
            )}
            <label className="field">
              <span>Email</span>
              <input name="email" type="email" placeholder="you@example.com" required />
            </label>
            <button className="primary-button" type="submit" disabled={isPending}>
              {isPending
                ? "Sending…"
                : authMode === "register"
                  ? "Create account"
                  : "Email me a sign-in link"}
            </button>
          </form>

          {authNotice ? (
            <div className={cn("notice", authNotice.ok ? "notice-success" : "notice-error")} style={{ marginTop: 12 }}>
              <strong>{authNotice.title}</strong>
              <p>{authNotice.message}</p>
              {authNotice.detail ? <p className="muted small">{authNotice.detail}</p> : null}
            </div>
          ) : (
            <div className="auth-footnote">
              <p className="muted">We&apos;ll email you a secure one-time link. No password required.</p>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard() {
  const router = useRouter();
  const { state, currentUser, logout, joinPool } = useAppState();
  const [joinCode, setJoinCode] = useState("");
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  if (!currentUser) return null;

  const poolsForUser = state.pools.filter((pool) =>
    pool.memberUserIds.includes(currentUser.id),
  );

  async function handleJoinPool() {
    if (!joinCode.trim()) return;
    setIsJoining(true);
    setJoinMessage(null);
    const pool = await joinPool(joinCode);
    setIsJoining(false);
    if (!pool) {
      setJoinMessage(`No pool found with code "${joinCode.toUpperCase()}". Check the code and try again.`);
      return;
    }
    router.push(`/pools/${pool.id}`);
  }

  const firstName = currentUser.userName.split(" ")[0] ?? currentUser.userName;

  return (
    <main className="dashboard-shell">
      {/* ── Top nav ───────────────────────────────────────────────────────── */}
      <nav className="dashboard-nav">
        <div className="brand-lockup">
          <strong>GolfPool</strong>
        </div>
        <div className="nav-actions">
          {/* Desktop create + join buttons */}
          <div style={{ display: "flex", gap: 8 }} className="nav-desktop-actions">
            <button
              className="secondary-button small-button"
              type="button"
              onClick={() => {
                setIsJoinOpen((v) => !v);
                setJoinMessage(null);
              }}
            >
              Join pool
            </button>
            <Link className="primary-button small-button" href="/create">
              + Create
            </Link>
          </div>
          <span className="profile-badge" title={currentUser.userName}>
            {currentUser.userName.slice(0, 1).toUpperCase()}
          </span>
        </div>
      </nav>

      {/* ── Hero / greeting ───────────────────────────────────────────────── */}
      <section className="home-hero">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Hey, {firstName} 👋</h1>
          <p className="muted">
            {poolsForUser.length === 0
              ? "No pools yet — create one or join with a code."
              : `${poolsForUser.length} active ${poolsForUser.length === 1 ? "pool" : "pools"} this week.`}
          </p>
        </div>
        {/* Mobile-only action row */}
        <div className="dashboard-actions" style={{ flexShrink: 0 }}>
          <Link className="primary-button small-button" href="/create">
            + New
          </Link>
        </div>
      </section>

      {/* ── Join strip ────────────────────────────────────────────────────── */}
      {isJoinOpen && (
        <div className="join-strip">
          <div className="join-inline">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter join code"
              onKeyDown={(e) => e.key === "Enter" && handleJoinPool()}
              autoFocus
            />
            <button
              className="primary-button"
              type="button"
              onClick={handleJoinPool}
              disabled={isJoining || !joinCode.trim()}
            >
              {isJoining ? "Joining…" : "Join"}
            </button>
          </div>
          {joinMessage && <p className="muted small">{joinMessage}</p>}
        </div>
      )}

      {/* ── Pool list panel ──────────────────────────────────────────────── */}
      <section className="dashboard-table-panel">
        <div className="dashboard-section-head">
          <h2>My Pools</h2>
          <span className="panel-kicker">
            {poolsForUser.length} {poolsForUser.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        {poolsForUser.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">⛳</span>
            <p style={{ fontWeight: 700 }}>No pools yet</p>
            <p className="muted small">
              Create a pool to get started, or join one with an invite code.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <Link className="primary-button small-button" href="/create">
                Create pool
              </Link>
              <button
                className="secondary-button small-button"
                type="button"
                onClick={() => setIsJoinOpen(true)}
              >
                Join with code
              </button>
            </div>
          </div>
        ) : (
          <div className="pool-card-list">
            {poolsForUser.map((pool) => {
              const tournament = state.tournaments.find(
                (candidate) => candidate.id === pool.tournamentId,
              );
              const fullLeaderboard = buildLeaderboard(state, pool);
              const rank = rankLabel(fullLeaderboard, currentUser.id);
              const myRow =
                fullLeaderboard.find((row) => row.userId === currentUser.id) ?? null;

              const statusLabel =
                tournament?.status === "finished"
                  ? "Done"
                  : tournament?.status === "in_progress"
                    ? "Live"
                    : "Upcoming";
              const statusClass =
                tournament?.status === "finished"
                  ? "completed"
                  : tournament?.status === "in_progress"
                    ? "live"
                    : "pending";

              const myEntry = state.entries.find(
                (e) => e.poolId === pool.id && e.userId === currentUser.id,
              );
              const draftStatus = myEntry?.submittedAt
                ? "Submitted"
                : myEntry
                  ? "Draft saved"
                  : "Not started";

              return (
                <Link className="pool-card" href={`/pools/${pool.id}`} key={pool.id}>
                  <div className="pool-card-body">
                    <span className="pool-card-tournament">
                      {tournament?.name ?? "Tournament TBD"}
                    </span>
                    <span className="pool-card-name">{pool.name}</span>
                    <div className="pool-card-meta">
                      <span>{draftStatus}</span>
                      {rank && (
                        <>
                          <span className="pool-card-meta-sep" />
                          <span>{rank}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="pool-card-right">
                    <span className={`status-pill ${statusClass}`}>{statusLabel}</span>
                    {myRow && (
                      <span className={scoreBadgeClass(myRow.teamScore)}>
                        {scoreLabel(myRow.teamScore)}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="dashboard-footer">
        <span>© 2026 GolfPool</span>
        <div className="dashboard-footer-links">
          <button className="footer-link-button" onClick={logout} type="button">
            Log out
          </button>
        </div>
      </footer>

      {/* ── Mobile bottom nav ─────────────────────────────────────────────── */}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <div className="mobile-bottom-nav-inner">
          <span
            className="mobile-nav-item active"
            aria-current="page"
          >
            <span className="mobile-nav-icon">⛳</span>
            Pools
          </span>
          <Link className="mobile-nav-item" href="/create">
            <span className="mobile-nav-icon">＋</span>
            Create
          </Link>
          <button
            className="mobile-nav-item"
            type="button"
            onClick={() => {
              setIsJoinOpen((v) => !v);
              setJoinMessage(null);
            }}
          >
            <span className="mobile-nav-icon">🔗</span>
            Join
          </button>
          <button
            className="mobile-nav-item"
            type="button"
            onClick={logout}
          >
            <span className="mobile-nav-icon">👤</span>
            Account
          </button>
        </div>
      </nav>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function AppShell() {
  const { currentUser, isReady } = useAppState();

  if (!isReady) {
    return (
      <main className="centered-page">
        <div className="panel callback-panel">
          <p className="eyebrow">Golf Pool</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
            <div className="skeleton-line tall medium" />
            <div className="skeleton-line short" />
          </div>
          <p className="muted small" style={{ marginTop: 4 }}>Checking your session…</p>
        </div>
      </main>
    );
  }

  if (!currentUser) return <AuthPage />;
  return <Dashboard />;
}
