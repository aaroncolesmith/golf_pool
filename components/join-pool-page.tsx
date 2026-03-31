"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAppState } from "@/lib/store";

export function JoinPoolPage({ code }: { code: string }) {
  const { state, currentUser, joinPool } = useAppState();
  const pool = useMemo(() => state.pools.find((candidate) => candidate.joinCode === code.toUpperCase()), [code, state.pools]);

  return (
    <main className="centered-page">
      <div className="panel callback-panel">
        <p className="eyebrow">Join Pool</p>
        <h1>{pool ? pool.name : "Pool not found"}</h1>
        {pool ? <p className="muted">Code: {pool.joinCode}</p> : null}
        {currentUser && pool ? (
          <>
            <button className="primary-button" onClick={() => joinPool(code)} type="button">
              Join as {currentUser.userName}
            </button>
            <Link className="secondary-button" href={`/pools/${pool.id}`}>
              Open pool
            </Link>
          </>
        ) : (
          <p className="muted">Sign in first to join this pool.</p>
        )}
      </div>
    </main>
  );
}
