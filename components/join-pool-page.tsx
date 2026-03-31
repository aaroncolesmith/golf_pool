"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAppState } from "@/lib/store";

export function JoinPoolPage({ code }: { code: string }) {
  const router = useRouter();
  const { currentUser, joinPool } = useAppState();
  const [joinMessage, setJoinMessage] = useState<string | null>(null);

  async function handleJoin() {
    setJoinMessage(null);
    const pool = await joinPool(code);

    if (!pool) {
      setJoinMessage("Unable to join this pool with that code yet.");
      return;
    }

    router.push(`/pools/${pool.id}`);
  }

  return (
    <main className="centered-page">
      <div className="panel callback-panel">
        <p className="eyebrow">Join Pool</p>
        <h1>Join with code {code.toUpperCase()}</h1>
        <p className="muted">Use this invite code to add the pool to your dashboard.</p>
        {currentUser ? (
          <>
            <button className="primary-button" onClick={handleJoin} type="button">
              Join as {currentUser.userName}
            </button>
            {joinMessage ? <p className="muted">{joinMessage}</p> : null}
          </>
        ) : (
          <p className="muted">Sign in first to join this pool.</p>
        )}
      </div>
    </main>
  );
}
