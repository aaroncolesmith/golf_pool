"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAppState } from "@/lib/store";

export function AuthCallback() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { consumeMagicLink, isUsingSupabase } = useAppState();
  const [userName, setUserName] = useState<string | null>(null);
  const consumedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (isUsingSupabase || !token || consumedTokenRef.current === token) {
      return;
    }

    const currentToken = token;

    async function applyMagicLink() {
      consumedTokenRef.current = currentToken;
      const user = await consumeMagicLink(currentToken);
      setUserName(user?.userName ?? null);
    }

    void applyMagicLink();
  }, [consumeMagicLink, isUsingSupabase, token]);

  return (
    <main className="centered-page">
      <div className="panel callback-panel">
        <p className="eyebrow">Magic Link</p>
        <h1>
          {isUsingSupabase
            ? "Supabase auth is enabled. Email links are confirmed through /auth/confirm."
            : userName
              ? `You are signed in as ${userName}`
              : "That magic link is no longer valid."}
        </h1>
        <Link className="primary-button" href="/">
          Return home
        </Link>
      </div>
    </main>
  );
}
