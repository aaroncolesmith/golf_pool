"use client";

import Link from "next/link";
import { useAppState } from "@/lib/store";

export function GlobalNav() {
  const { currentUser } = useAppState();

  return (
    <nav className="dashboard-nav">
      <Link href="/" className="brand-lockup" style={{ textDecoration: "none" }}>
        <img src="/golf_pool_image.png" alt="GolfPool logo" style={{ height: 36, width: "auto" }} />
        <strong>GolfPool</strong>
        <span style={{ fontSize: "0.65rem", fontWeight: 500, color: "var(--muted)", letterSpacing: "0.03em", marginLeft: 5 }}>v0.51</span>
      </Link>
      <div className="nav-actions">
        {currentUser && (
          <span className="profile-badge" title={currentUser.userName}>
            {currentUser.userName.slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
    </nav>
  );
}
