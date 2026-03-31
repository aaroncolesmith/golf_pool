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
        <p className="eyebrow">Email Sign-In</p>
        <h1>
          {isUsingSupabase
            ? "Your email link has been confirmed."
            : userName
              ? `You are signed in as ${userName}.`
              : "That sign-in link is no longer valid."}
        </h1>
        <p className="muted">
          {isUsingSupabase
            ? "You can close this tab and return to the app, or continue straight to your dashboard."
            : userName
              ? "Your session is active on this device."
              : "Request a fresh email link to continue."}
        </p>
        <Link className="primary-button" href="/">
          Continue
        </Link>
      </div>
    </main>
  );
}
