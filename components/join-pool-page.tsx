"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAppState } from "@/lib/store";
import { cn } from "@/lib/utils";

type PoolPreview = {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  memberCount: number;
};

type AuthNotice = {
  ok: boolean;
  title: string;
  message: string;
};

export function JoinPoolPage({ code }: { code: string }) {
  const router = useRouter();
  const { currentUser, joinPool, register, login, isReady } = useAppState();
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [poolPreview, setPoolPreview] = useState<PoolPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  // Auth form state for unauthenticated users
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null);
  const [isPendingAuth, setIsPendingAuth] = useState(false);

  const displayCode = code.toUpperCase();

  useEffect(() => {
    fetch(`/api/pools/preview?code=${encodeURIComponent(displayCode)}`)
      .then((r) => r.json())
      .then((data: { ok: boolean; pool?: PoolPreview }) => {
        if (data.ok && data.pool) setPoolPreview(data.pool);
      })
      .catch(() => null)
      .finally(() => setPreviewLoading(false));
  }, [displayCode]);

  async function handleJoin() {
    setJoinMessage(null);
    setIsJoining(true);
    const pool = await joinPool(code);
    setIsJoining(false);

    if (!pool) {
      setJoinMessage(
        "Unable to join with that code. The pool may be locked or the code may be incorrect.",
      );
      return;
    }

    router.push(`/pools/${pool.id}`);
  }

  async function handleAuth(formData: FormData) {
    const email = String(formData.get("email") ?? "");
    setIsPendingAuth(true);
    setAuthNotice(null);

    try {
      if (authMode === "register") {
        const userName = String(formData.get("userName") ?? "");
        const result = await register(userName, email);
        setAuthNotice({
          ok: result.ok,
          title: result.ok ? "Check your inbox" : "Couldn't send that link",
          message: result.message,
        });
      } else {
        const result = await login(email);
        setAuthNotice({
          ok: result.ok,
          title: result.ok ? "Check your inbox" : "Couldn't send that link",
          message: result.message,
        });
      }
    } finally {
      setIsPendingAuth(false);
    }
  }

  if (!isReady) {
    return (
      <div className="join-page">
        <div className="join-card">
          <div className="join-card-header">
            <div className="skeleton-line short" style={{ height: 10, marginBottom: 8 }} />
            <div className="skeleton-line medium" style={{ height: 22 }} />
          </div>
          <div className="join-card-body">
            <div className="skeleton-line" style={{ height: 44, borderRadius: 12 }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="join-page">
      <div className="join-card">
        {/* Card header */}
        <div className="join-card-header">
          <p className="eyebrow" style={{ marginBottom: 8 }}>GolfPool invite</p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em" }}>
              {previewLoading ? "Loading pool…" : (poolPreview?.name ?? "Join with code")}
            </h1>
            <span className="join-code-display">{displayCode}</span>
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: "0.9rem" }}>
            Someone invited you to their golf pool.
          </p>
        </div>

        {/* Description banner — shown prominently if present */}
        {poolPreview?.description && (
          <div
            style={{
              margin: "0 0 4px",
              padding: "14px 18px",
              background: "var(--primary-soft)",
              borderRadius: 12,
              border: "1px solid rgba(28,110,231,0.15)",
            }}
          >
            <p
              style={{
                fontSize: "0.72rem",
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--primary)",
                marginBottom: 6,
              }}
            >
              Pool Info
            </p>
            <p style={{ fontSize: "0.92rem", lineHeight: 1.55, margin: 0, whiteSpace: "pre-wrap" }}>
              {poolPreview.description}
            </p>
          </div>
        )}

        <div className="join-card-body">
          {currentUser ? (
            /* ── Authenticated: one-tap join ───────────────────────────── */
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  background: "var(--primary-soft)",
                  borderRadius: 12,
                  border: "1px solid rgba(28,110,231,0.15)",
                }}
              >
                <span className="profile-badge">
                  {currentUser.userName.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <p style={{ fontWeight: 700, fontSize: "0.92rem" }}>
                    {currentUser.userName}
                  </p>
                  <p className="muted small">Joining as this account</p>
                </div>
              </div>

              <button
                className="primary-button"
                onClick={handleJoin}
                disabled={isJoining}
                type="button"
                style={{ width: "100%", justifyContent: "center" }}
              >
                {isJoining ? "Joining…" : `Join pool`}
              </button>

              {joinMessage && (
                <div className="notice notice-error">
                  <p>{joinMessage}</p>
                </div>
              )}

              <p className="muted small" style={{ textAlign: "center" }}>
                Not {currentUser.userName}?{" "}
                <Link href="/" style={{ color: "var(--primary)", fontWeight: 600 }}>
                  Switch account
                </Link>
              </p>
            </>
          ) : (
            /* ── Unauthenticated: inline auth then join ─────────────────── */
            <>
              <div className="join-auth-prompt">
                <p style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                  Sign in to join this pool
                </p>
                <p className="muted small">
                  Create a free account or log in — we&apos;ll send you a magic link.
                </p>
              </div>

              {/* Auth mode tabs */}
              <div className="tabs">
                <button
                  className={cn("tab", authMode === "register" && "active")}
                  type="button"
                  onClick={() => {
                    setAuthMode("register");
                    setAuthNotice(null);
                  }}
                >
                  New account
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
                    <input
                      name="userName"
                      placeholder="Pool nickname"
                      required
                    />
                  </label>
                )}
                <label className="field">
                  <span>Email</span>
                  <input
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    required
                  />
                </label>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={isPendingAuth}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {isPendingAuth
                    ? "Sending…"
                    : authMode === "register"
                      ? "Create account & join"
                      : "Email me a sign-in link"}
                </button>
              </form>

              {authNotice && (
                <div
                  className={cn(
                    "notice",
                    authNotice.ok ? "notice-success" : "notice-error",
                  )}
                >
                  <strong>{authNotice.title}</strong>
                  <p>{authNotice.message}</p>
                  {authNotice.ok && (
                    <p className="muted small">
                      After signing in, come back to this link to complete joining.
                    </p>
                  )}
                </div>
              )}

              <p className="muted small" style={{ textAlign: "center" }}>
                We&apos;ll email you a secure one-time link. No password needed.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
